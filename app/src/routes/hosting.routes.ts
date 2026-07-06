import express, { Response } from 'express';
import { query } from '../config/database';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { getRazorpayConfig } from '../services/payment-settings.service';
import { ensureHostingTables, activateHostingSubscription } from '../services/hosting.service';
import {
    createRazorpaySubscription,
    verifySubscriptionSignature,
    recordOrder,
    getRazorpayClient,
} from '../services/razorpay.service';

const router = express.Router();

// ─── Helper: is hosting enabled for this tenant? ─────────────────────────────
async function hostingEnabledFor(tenantId: number): Promise<boolean> {
    await ensureHostingTables();
    const rows: any = await query('SELECT hosting_enabled FROM tenants WHERE id = ?', [tenantId]);
    return !!rows?.[0]?.hosting_enabled;
}

// ─── GET /api/hosting/plans ───────────────────────────────────────────────────
// Gated by the per-tenant hosting_enabled flag. Returns enabled=false (not 403)
// so the dashboard can simply hide the section.
router.get('/plans', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const enabled = await hostingEnabledFor(req.user.id);
        if (!enabled) return res.json({ enabled: false, plans: [], subscription: null });

        const plans: any = await query(
            'SELECT id, name, price, storage_gb, ram_gb, bandwidth, billing_period FROM hosting_plans WHERE is_active = TRUE ORDER BY price ASC'
        );

        const subs: any = await query(
            `SELECT hs.*, hp.name AS plan_name, hp.price, hp.storage_gb, hp.ram_gb, hp.bandwidth, hp.billing_period
             FROM hosting_subscriptions hs
             JOIN hosting_plans hp ON hs.hosting_plan_id = hp.id
             WHERE hs.tenant_id = ? AND hs.status = 'active'
             ORDER BY hs.current_period_end DESC LIMIT 1`,
            [req.user.id]
        );

        res.json({ enabled: true, plans, subscription: subs.length > 0 ? subs[0] : null });
    } catch (error) {
        console.error('Hosting plans fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch hosting plans' });
    }
});

// ─── POST /api/hosting/razorpay/subscribe ─────────────────────────────────────
router.post('/razorpay/subscribe', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { planId } = req.body;
        const tenantId = req.user.id;
        if (!planId) return res.status(400).json({ error: 'planId is required' });

        if (!(await hostingEnabledFor(tenantId))) {
            return res.status(403).json({ error: 'Hosting service is not enabled for your store' });
        }

        const config = await getRazorpayConfig();
        if (!config.enabled) return res.status(400).json({ error: 'Online payments are not enabled' });

        const plans: any = await query('SELECT * FROM hosting_plans WHERE id = ? AND is_active = TRUE', [planId]);
        if (!plans || plans.length === 0) return res.status(404).json({ error: 'Hosting plan not found' });
        const plan = plans[0];

        const tenants: any = await query('SELECT id, store_name, email FROM tenants WHERE id = ?', [tenantId]);
        const tenant = tenants[0];

        const subscription = await createRazorpaySubscription(tenant, plan, { table: 'hosting_plans', product: 'hosting' });

        await recordOrder({
            tenantId,
            planId: plan.id,
            planName: `Hosting — ${plan.name}`,
            razorpaySubscriptionId: subscription.id,
            amount: Number(plan.price),
            currency: config.currency,
            status: 'created',
            email: tenant.email,
            notes: 'Hosting checkout initiated',
            product: 'hosting',
        });

        res.json({
            subscriptionId: subscription.id,
            keyId: config.key_id,
            currency: config.currency,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            prefill: { email: tenant.email, name: tenant.store_name },
        });
    } catch (error: any) {
        console.error('Hosting razorpay subscribe error:', error);
        const detail = error?.error?.description || error?.message;
        res.status(500).json({ error: detail || 'Failed to start checkout' });
    }
});

// ─── POST /api/hosting/razorpay/verify ────────────────────────────────────────
router.post('/razorpay/verify', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, planId } = req.body;
        const tenantId = req.user.id;

        if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature || !planId) {
            return res.status(400).json({ error: 'Missing payment verification fields' });
        }

        const config = await getRazorpayConfig();
        const valid = verifySubscriptionSignature(
            razorpay_payment_id, razorpay_subscription_id, razorpay_signature, config.key_secret
        );
        if (!valid) {
            await recordOrder({
                tenantId,
                razorpaySubscriptionId: razorpay_subscription_id,
                razorpayPaymentId: razorpay_payment_id,
                amount: 0,
                currency: config.currency,
                status: 'failed',
                notes: 'Signature verification failed',
                product: 'hosting',
            });
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        const plans: any = await query('SELECT * FROM hosting_plans WHERE id = ?', [planId]);
        if (!plans || plans.length === 0) return res.status(404).json({ error: 'Hosting plan not found' });
        const plan = plans[0];

        // Payment details for the order record
        let method: string | null = null;
        let contact: string | null = null;
        let email: string | null = null;
        let amount = Number(plan.price);
        try {
            const { client } = await getRazorpayClient();
            const payment: any = await client.payments.fetch(razorpay_payment_id);
            method = payment.method || null;
            contact = payment.contact || null;
            email = payment.email || null;
            if (payment.amount) amount = Number(payment.amount) / 100;
        } catch (e) {
            console.warn('Could not fetch payment details:', e);
        }

        const { invoiceNumber, periodEnd } = await activateHostingSubscription({
            tenantId,
            plan,
            currency: config.currency,
            billingReason: 'hosting_create',
            razorpaySubscriptionId: razorpay_subscription_id,
        });

        await recordOrder({
            tenantId,
            planId: plan.id,
            planName: `Hosting — ${plan.name}`,
            razorpaySubscriptionId: razorpay_subscription_id,
            razorpayPaymentId: razorpay_payment_id,
            amount,
            currency: config.currency,
            status: 'captured',
            method,
            email,
            contact,
            notes: 'Initial hosting payment',
            product: 'hosting',
        });

        res.json({
            message: `Hosting plan ${plan.name} activated`,
            invoiceNumber,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            periodEnd,
        });
    } catch (error) {
        console.error('Hosting razorpay verify error:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

// ─── POST /api/hosting/subscribe ──────────────────────────────────────────────
// Demo-mode purchase (no gateway). Blocked when Razorpay is live.
router.post('/subscribe', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { planId } = req.body;
        const tenantId = req.user.id;
        if (!planId) return res.status(400).json({ error: 'planId is required' });

        if (!(await hostingEnabledFor(tenantId))) {
            return res.status(403).json({ error: 'Hosting service is not enabled for your store' });
        }

        const config = await getRazorpayConfig();
        if (config.enabled && config.key_id) {
            return res.status(400).json({ error: 'Online payment is required. Use the checkout flow.' });
        }

        const plans: any = await query('SELECT * FROM hosting_plans WHERE id = ? AND is_active = TRUE', [planId]);
        if (!plans || plans.length === 0) return res.status(404).json({ error: 'Hosting plan not found' });
        const plan = plans[0];

        const { invoiceNumber, periodEnd } = await activateHostingSubscription({
            tenantId,
            plan,
            currency: 'USD',
            billingReason: 'hosting_create',
        });

        res.json({
            message: `Hosting plan ${plan.name} activated`,
            invoiceNumber,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            periodEnd,
        });
    } catch (error) {
        console.error('Hosting demo subscribe error:', error);
        res.status(500).json({ error: 'Failed to activate hosting plan' });
    }
});

// ─── POST /api/hosting/cancel ─────────────────────────────────────────────────
router.post('/cancel', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        await ensureHostingTables();
        const tenantId = req.user.id;
        const subs: any = await query(
            "SELECT id, razorpay_subscription_id FROM hosting_subscriptions WHERE tenant_id = ? AND status = 'active' ORDER BY current_period_end DESC LIMIT 1",
            [tenantId]
        );
        if (!subs || subs.length === 0) return res.status(404).json({ error: 'No active hosting subscription found' });

        const sub = subs[0];

        if (sub.razorpay_subscription_id) {
            try {
                const { client } = await getRazorpayClient();
                await client.subscriptions.cancel(sub.razorpay_subscription_id, true); // cancel at cycle end
            } catch (e: any) {
                console.warn('Razorpay hosting cancel warning:', e?.error?.description || e?.message);
            }
        }

        await query("UPDATE hosting_subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?", [sub.id]);
        res.json({ message: 'Hosting subscription cancelled. Service remains active until the end of the billing period.' });
    } catch (error) {
        console.error('Hosting cancel error:', error);
        res.status(500).json({ error: 'Failed to cancel hosting subscription' });
    }
});

export default router;
