import express, { Response } from 'express';
import { query } from '../config/database';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { getRazorpayConfig } from '../services/payment-settings.service';
import { ensureHostingTables, activateHostingSubscription } from '../services/hosting.service';
import { createRazorpaySubscription, recordOrder, PlanMappingError } from '../services/razorpay.service';
import {
    BillingError,
    createCheckoutRecord,
    expireEndedSubscriptions,
    requestCancel,
    verifyCheckout,
} from '../services/subscription-lifecycle.service';

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
            'SELECT id, name, price, storage_gb, ram_gb, bandwidth, billing_period, parent_plan_id, yearly_discount_percent FROM hosting_plans WHERE is_active = TRUE ORDER BY price ASC'
        );

        await expireEndedSubscriptions(req.user.id);
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

        const subscription = await createRazorpaySubscription(tenant, plan, { table: 'hosting_plans', product: 'hosting', checkoutType: 'immediate' });

        await createCheckoutRecord({
            product: 'hosting',
            tenantId,
            planId: plan.id,
            razorpaySubscriptionId: subscription.id,
            checkoutType: 'immediate',
        });

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
        if (error instanceof PlanMappingError) {
            console.error('Razorpay hosting plan mapping error:', error.message);
            return res.status(409).json({ error: 'This hosting plan is not available for online payment yet. Please contact support.' });
        }
        console.error('Hosting razorpay subscribe error:', error);
        const detail = error?.error?.description || error?.message;
        res.status(500).json({ error: detail || 'Failed to start checkout' });
    }
});

// ─── POST /api/hosting/razorpay/verify ────────────────────────────────────────
// The hosting plan is taken from the Razorpay subscription, never the body.
router.post('/razorpay/verify', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
        if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment verification fields' });
        }

        const r = await verifyCheckout({
            product: 'hosting',
            tenantId: req.user.id,
            paymentId: razorpay_payment_id,
            subscriptionId: razorpay_subscription_id,
            signature: razorpay_signature,
        });
        const plan = r.plan;

        res.json({
            message: `Hosting plan ${plan.name} activated`,
            invoiceNumber: r.invoiceNumber,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            periodEnd: r.periodEnd,
        });
    } catch (error: any) {
        if (error instanceof BillingError) return res.status(error.status).json({ error: error.message });
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
// Cancelled at Razorpay at cycle end; hosting stays active until current_period_end.
router.post('/cancel', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        await ensureHostingTables();
        const r = await requestCancel('hosting', req.user.id);
        res.json({ message: r.message.replace('Subscription cancelled', 'Hosting subscription cancelled'), accessUntil: r.accessUntil });
    } catch (error: any) {
        if (error instanceof BillingError) {
            const msg = error.status === 404 ? 'No active hosting subscription found' : error.message;
            return res.status(error.status).json({ error: msg });
        }
        console.error('Hosting cancel error:', error);
        res.status(500).json({ error: 'Failed to cancel hosting subscription' });
    }
});

export default router;
