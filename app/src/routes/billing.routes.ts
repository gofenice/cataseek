import express, { Response } from 'express';
import { query } from '../config/database';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { generateInvoicePDF } from '../services/pdf.service';
import { sendInvoiceEmail, sendSubscriptionWelcomeEmail, sendPaymentFailedEmail, sendSubscriptionPausedEmail } from '../services/mailer.service';
import { getRazorpayConfig, getCompanyConfig } from '../services/payment-settings.service';
import {
    createRazorpaySubscription,
    verifySubscriptionSignature,
    verifyWebhookSignature,
    recordOrder,
    ensurePaymentTables,
    getRazorpayClient,
} from '../services/razorpay.service';
import { activateHostingSubscription } from '../services/hosting.service';

const router = express.Router();

// ─── Helper: build invoice number ─────────────────────────────────────────────
function makeInvoiceNumber(id: number): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${String(id).padStart(5, '0')}`;
}

// ─── Helper: prorated unused value of the current subscription ────────────────
// Used as a ONE-TIME credit on the first charge when a client changes plan
// mid-cycle. E.g. half of a ₹2,999 month left → ₹1,499.50 off the new plan's
// first payment; full price resumes from the next cycle.
async function getPlanChangeCredit(tenantId: number): Promise<{ credit: number; oldPlanName: string | null }> {
    const subs: any = await query(
        `SELECT s.current_period_start, s.current_period_end, p.price, p.name
         FROM subscriptions s
         JOIN plans p ON s.plan_id = p.id
         WHERE s.tenant_id = ? AND s.status = 'active'
         ORDER BY s.current_period_end DESC LIMIT 1`,
        [tenantId]
    );
    if (!subs || subs.length === 0) return { credit: 0, oldPlanName: null };

    const sub = subs[0];
    const now = Date.now();
    const start = new Date(sub.current_period_start).getTime();
    const end = new Date(sub.current_period_end).getTime();
    if (!start || !end || end <= now || end <= start) return { credit: 0, oldPlanName: null };

    const credit = Number(sub.price) * ((end - now) / (end - start));
    return { credit: Math.round(credit * 100) / 100, oldPlanName: sub.name };
}

// ─── Ensure invoices table exists (lazy migration) ────────────────────────────
async function ensureInvoicesTable() {
    await query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id        INT NOT NULL,
      invoice_number   VARCHAR(30) NOT NULL,
      plan_name        VARCHAR(100) NOT NULL,
      billing_reason   VARCHAR(100) NOT NULL DEFAULT 'subscription_cycle',
      amount           DECIMAL(10,2) NOT NULL,
      currency         VARCHAR(10) NOT NULL DEFAULT 'USD',
      status           ENUM('paid','pending','failed') NOT NULL DEFAULT 'pending',
      period_start     DATETIME,
      period_end       DATETIME,
      paid_at          DATETIME,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      INDEX idx_tenant (tenant_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// ─── Shared: activate a subscription for a tenant ─────────────────────────────
// Used by demo subscribe, Razorpay verify, and webhook renewals.
async function activateSubscription(opts: {
    tenantId: number;
    plan: any;
    currency?: string;
    billingReason?: string;
    razorpaySubscriptionId?: string | null;
    amountOverride?: number; // actual amount paid (e.g. first charge after plan-change credit)
}) {
    const { tenantId, plan } = opts;
    const currency = opts.currency || 'USD';
    const billingReason = opts.billingReason || 'subscription_create';
    const invoiceAmount = opts.amountOverride !== undefined ? opts.amountOverride : Number(plan.price);

    await ensureInvoicesTable();

    const tenants: any = await query('SELECT store_name, email FROM tenants WHERE id = ?', [tenantId]);
    if (!tenants || tenants.length === 0) throw new Error('Tenant not found');
    const tenant = tenants[0];

    // Plan change: stop the OLD recurring mandate at the gateway too, otherwise
    // Razorpay keeps auto-charging the replaced subscription (double billing).
    // Guard: webhook renewals re-activate the SAME subscription id — don't cancel those.
    const oldSubs: any = await query(
        "SELECT razorpay_subscription_id FROM subscriptions WHERE tenant_id = ? AND status = 'active' AND razorpay_subscription_id IS NOT NULL",
        [tenantId]
    );
    for (const old of oldSubs) {
        if (old.razorpay_subscription_id && old.razorpay_subscription_id !== opts.razorpaySubscriptionId) {
            try {
                const { client } = await getRazorpayClient();
                await client.subscriptions.cancel(old.razorpay_subscription_id, false); // immediate — replaced by new plan
            } catch (e: any) {
                console.warn('Old subscription gateway cancel warning:', e?.error?.description || e?.message);
            }
        }
    }

    // Cancel any existing active subscription
    await query(
        "UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE tenant_id = ? AND status = 'active'",
        [tenantId]
    );

    // Calculate period
    const periodStart = new Date();
    const periodEnd = new Date();
    if (plan.billing_period === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Insert subscription
    await query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end, razorpay_subscription_id)
         VALUES (?, ?, 'active', ?, ?, ?)`,
        [tenantId, plan.id, periodStart, periodEnd, opts.razorpaySubscriptionId || null]
    );

    // Update tenant
    await query("UPDATE tenants SET status = 'active', plan_id = ? WHERE id = ?", [plan.id, tenantId]);

    // Create invoice record
    const invResult: any = await query(
        `INSERT INTO invoices (tenant_id, invoice_number, plan_name, billing_reason, amount, currency, status, period_start, period_end, paid_at)
         VALUES (?, 'TEMP', ?, ?, ?, ?, 'paid', ?, ?, NOW())`,
        [tenantId, plan.name, billingReason, invoiceAmount, currency, periodStart, periodEnd]
    );
    const invoiceId = invResult.insertId;
    const invoiceNumber = makeInvoiceNumber(invoiceId);
    await query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [invoiceNumber, invoiceId]);

    // Generate PDF + emails (fire-and-forget)
    const company = await getCompanyConfig();
    generateInvoicePDF({
        invoiceNumber,
        issueDate: new Date(),
        status: 'paid',
        companyName: company.company_name,
        companyEmail: company.company_email,
        companyUrl: process.env.FRONTEND_URL || 'https://cataseek.com',
        companyAddress: company.company_address,
        companyGstin: company.company_gstin,
        taxRatePercent: company.tax_rate,
        taxLabel: company.tax_label,
        storeName: tenant.store_name,
        storeEmail: tenant.email,
        currency,
        lineItems: [{
            description: opts.amountOverride !== undefined && invoiceAmount < Number(plan.price)
                ? `${plan.name} Plan (one-time plan-change credit applied)`
                : `${plan.name} Plan`,
            period: `${periodStart.toLocaleDateString()} – ${periodEnd.toLocaleDateString()}`,
            amount: invoiceAmount,
        }],
    })
        .then((pdfBuffer) =>
            sendInvoiceEmail(tenant.email, tenant.store_name, invoiceNumber, plan.name, invoiceAmount, pdfBuffer)
        )
        .catch((e) => console.error('Invoice email error:', e));

    sendSubscriptionWelcomeEmail(tenant.email, tenant.store_name, plan.name, parseFloat(plan.price), periodEnd)
        .catch((e) => console.error('Welcome email error:', e));

    return { invoiceNumber, periodStart, periodEnd, tenant };
}

// ─── GET /api/billing/payment-config ──────────────────────────────────────────
// Tells the dashboard which gateway to use for checkout
router.get('/payment-config', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const config = await getRazorpayConfig();
        const razorpayReady = config.enabled && !!config.key_id && !!config.key_secret;
        res.json({
            gateway: razorpayReady ? 'razorpay' : 'demo',
            key_id: razorpayReady ? config.key_id : null,
            currency: config.currency,
            mode: config.mode,
        });
    } catch (error) {
        console.error('Payment config error:', error);
        res.json({ gateway: 'demo', key_id: null, currency: 'USD', mode: 'test' });
    }
});

// ─── GET /api/billing/invoices ─────────────────────────────────────────────────
router.get('/invoices', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        await ensureInvoicesTable();
        const rows: any = await query(
            `SELECT id, invoice_number, plan_name, billing_reason, amount, currency,
              status, period_start, period_end, paid_at, created_at
       FROM invoices
       WHERE tenant_id = ?
       ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json({ invoices: rows });
    } catch (error) {
        console.error('Fetch invoices error:', error);
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});

// ─── GET /api/billing/orders ───────────────────────────────────────────────────
// Tenant's own payment history
router.get('/orders', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        const rows: any = await query(
            `SELECT id, plan_name, razorpay_payment_id, razorpay_subscription_id, amount, currency, status, method, created_at
       FROM orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50`,
            [req.user.id]
        );
        res.json({ orders: rows });
    } catch (error) {
        console.error('Fetch orders error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// ─── GET /api/billing/invoices/:id/download ────────────────────────────────────
router.get('/invoices/:id/download', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        await ensureInvoicesTable();
        const rows: any = await query(
            `SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`,
            [req.params.id, req.user.id]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const inv = rows[0];

        const tenants: any = await query(
            'SELECT store_name, email, store_domain FROM tenants WHERE id = ?',
            [req.user.id]
        );
        const tenant = tenants[0];

        const company = await getCompanyConfig();
        const pdfBuffer = await generateInvoicePDF({
            invoiceNumber: inv.invoice_number,
            issueDate: new Date(inv.created_at),
            dueDate: inv.paid_at ? new Date(inv.paid_at) : undefined,
            status: inv.status,
            companyName: company.company_name,
            companyEmail: company.company_email,
            companyUrl: process.env.FRONTEND_URL || 'https://cataseek.com',
            companyAddress: company.company_address,
            companyGstin: company.company_gstin,
            taxRatePercent: company.tax_rate,
            taxLabel: company.tax_label,
            storeName: tenant.store_name,
            storeEmail: tenant.email,
            storeDomain: tenant.store_domain,
            currency: inv.currency,
            lineItems: [
                {
                    description: `${inv.plan_name} Plan`,
                    period: inv.period_start && inv.period_end
                        ? `${new Date(inv.period_start).toLocaleDateString()} – ${new Date(inv.period_end).toLocaleDateString()}`
                        : undefined,
                    amount: parseFloat(inv.amount),
                },
            ],
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Invoice download error:', error);
        res.status(500).json({ error: 'Failed to generate invoice PDF' });
    }
});

// ─── POST /api/billing/razorpay/subscribe ─────────────────────────────────────
// Step 1 of checkout: create a Razorpay subscription, return its id so the
// frontend can open Razorpay Checkout.
router.post('/razorpay/subscribe', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { planId } = req.body;
        const tenantId = req.user.id;

        if (!planId) return res.status(400).json({ error: 'planId is required' });

        const config = await getRazorpayConfig();
        if (!config.enabled) return res.status(400).json({ error: 'Online payments are not enabled' });

        const plans: any = await query('SELECT * FROM plans WHERE id = ? AND is_active = TRUE', [planId]);
        if (!plans || plans.length === 0) return res.status(404).json({ error: 'Plan not found' });
        const plan = plans[0];

        const tenants: any = await query('SELECT id, store_name, email FROM tenants WHERE id = ?', [tenantId]);
        const tenant = tenants[0];

        // One-time plan-change credit: unused value of the current subscription
        // is deducted from the FIRST charge; recurring full price starts next cycle.
        const { credit, oldPlanName } = await getPlanChangeCredit(tenantId);
        const creditApplied = credit > 0 ? Math.min(credit, Number(plan.price) - 1) : 0;
        const firstCharge = Math.round((Number(plan.price) - creditApplied) * 100) / 100;

        let subscription: any;
        if (creditApplied > 0) {
            // Recurring mandate starts next cycle; discounted first cycle collected now
            const startAt = new Date();
            if (plan.billing_period === 'yearly') startAt.setFullYear(startAt.getFullYear() + 1);
            else startAt.setMonth(startAt.getMonth() + 1);

            subscription = await createRazorpaySubscription(tenant, plan, {
                product: 'search',
                startAt: Math.floor(startAt.getTime() / 1000),
                upfront: {
                    amount: firstCharge,
                    label: `${plan.name} Plan — first cycle (credit from ${oldPlanName || 'previous plan'} applied)`,
                },
            });
        } else {
            subscription = await createRazorpaySubscription(tenant, plan, { product: 'search' });
        }

        // Record a pending order so we can track abandoned checkouts too
        await recordOrder({
            tenantId,
            planId: plan.id,
            planName: plan.name,
            razorpaySubscriptionId: subscription.id,
            amount: firstCharge,
            currency: config.currency,
            status: 'created',
            email: tenant.email,
            notes: creditApplied > 0 ? `Checkout initiated (plan-change credit ${creditApplied} applied)` : 'Checkout initiated',
        });

        res.json({
            subscriptionId: subscription.id,
            keyId: config.key_id,
            currency: config.currency,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            creditApplied,
            firstCharge,
            prefill: { email: tenant.email, name: tenant.store_name },
        });
    } catch (error: any) {
        console.error('Razorpay subscribe error:', error);
        const detail = error?.error?.description || error?.message;
        res.status(500).json({ error: detail || 'Failed to start checkout' });
    }
});

// ─── POST /api/billing/razorpay/verify ────────────────────────────────────────
// Step 2 of checkout: Razorpay Checkout returns payment_id + signature.
// Verify the signature, then activate the subscription + create invoice/order.
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
            });
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        const plans: any = await query('SELECT * FROM plans WHERE id = ?', [planId]);
        if (!plans || plans.length === 0) return res.status(404).json({ error: 'Plan not found' });
        const plan = plans[0];

        // Fetch payment details from Razorpay for the order record (method, contact)
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

        const { invoiceNumber, periodEnd } = await activateSubscription({
            tenantId,
            plan,
            currency: config.currency,
            billingReason: amount < Number(plan.price) ? 'subscription_upgrade' : 'subscription_create',
            razorpaySubscriptionId: razorpay_subscription_id,
            amountOverride: amount, // invoice matches what was actually charged (credit-adjusted)
        });

        await recordOrder({
            tenantId,
            planId: plan.id,
            planName: plan.name,
            razorpaySubscriptionId: razorpay_subscription_id,
            razorpayPaymentId: razorpay_payment_id,
            amount,
            currency: config.currency,
            status: 'captured',
            method,
            email,
            contact,
            notes: 'Initial subscription payment',
        });

        const creditApplied = Math.max(0, Math.round((Number(plan.price) - amount) * 100) / 100);
        res.json({
            message: creditApplied > 0
                ? `Successfully subscribed to ${plan.name} — ${creditApplied.toFixed(2)} credit from your previous plan applied to the first charge`
                : `Successfully subscribed to ${plan.name}`,
            invoiceNumber,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            creditApplied,
            firstCharge: amount,
            periodEnd,
        });
    } catch (error) {
        console.error('Razorpay verify error:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

// ─── POST /api/billing/razorpay/webhook ───────────────────────────────────────
// Handles recurring charges + lifecycle events. Mounted with express.raw in
// server.ts so the signature can be verified against the raw body.
router.post('/razorpay/webhook', async (req: AuthRequest, res: Response) => {
    try {
        const config = await getRazorpayConfig();
        const signature = req.headers['x-razorpay-signature'] as string;

        if (!signature || !config.webhook_secret) {
            return res.status(400).json({ error: 'Missing webhook signature or secret' });
        }

        const rawBody: Buffer = req.body; // Buffer (express.raw)
        if (!verifyWebhookSignature(rawBody, signature, config.webhook_secret)) {
            return res.status(400).json({ error: 'Invalid webhook signature' });
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        console.log(`[Razorpay webhook] ${event.event}`);

        switch (event.event) {
            case 'subscription.charged': {
                // Recurring renewal payment
                const sub = event.payload?.subscription?.entity;
                const payment = event.payload?.payment?.entity;
                if (!sub) break;

                const tenantId = parseInt(sub.notes?.tenant_id || '0');
                const planId = parseInt(sub.notes?.plan_id || '0');
                const product = sub.notes?.product === 'hosting' ? 'hosting' : 'search';
                if (!tenantId || !planId) break;

                // Skip the very first charge — already handled by /verify
                const existing: any = payment?.id
                    ? await query('SELECT id FROM orders WHERE razorpay_payment_id = ?', [payment.id])
                    : [];
                if (existing.length > 0) break;

                const table = product === 'hosting' ? 'hosting_plans' : 'plans';
                const plans: any = await query(`SELECT * FROM ${table} WHERE id = ?`, [planId]);
                if (!plans || plans.length === 0) break;
                const plan = plans[0];

                if (product === 'hosting') {
                    await activateHostingSubscription({
                        tenantId,
                        plan,
                        currency: config.currency,
                        billingReason: 'hosting_cycle',
                        razorpaySubscriptionId: sub.id,
                    });
                } else {
                    await activateSubscription({
                        tenantId,
                        plan,
                        currency: config.currency,
                        billingReason: 'subscription_cycle',
                        razorpaySubscriptionId: sub.id,
                    });
                }

                if (payment?.id) {
                    await recordOrder({
                        tenantId,
                        planId: plan.id,
                        planName: product === 'hosting' ? `Hosting — ${plan.name}` : plan.name,
                        razorpaySubscriptionId: sub.id,
                        razorpayPaymentId: payment.id,
                        amount: Number(payment.amount || 0) / 100,
                        currency: payment.currency || config.currency,
                        status: 'captured',
                        method: payment.method || null,
                        email: payment.email || null,
                        contact: payment.contact || null,
                        notes: 'Recurring subscription charge',
                        product,
                    });
                }
                break;
            }

            case 'subscription.cancelled':
            case 'subscription.halted': {
                const sub = event.payload?.subscription?.entity;
                if (!sub) break;

                if (sub.notes?.product === 'hosting') {
                    // Hosting cancellation — only the hosting service stops
                    await query(
                        "UPDATE hosting_subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE razorpay_subscription_id = ?",
                        [sub.id]
                    );
                    break;
                }

                await query(
                    "UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE razorpay_subscription_id = ?",
                    [sub.id]
                );

                const rows: any = await query(
                    'SELECT tenant_id FROM subscriptions WHERE razorpay_subscription_id = ? LIMIT 1',
                    [sub.id]
                );
                if (rows.length > 0) {
                    // Only suspend if the tenant has no OTHER active subscription —
                    // plan upgrades cancel the old gateway subscription while the new one is live.
                    const stillActive: any = await query(
                        "SELECT id FROM subscriptions WHERE tenant_id = ? AND status = 'active' LIMIT 1",
                        [rows[0].tenant_id]
                    );
                    if (stillActive.length === 0) {
                        await query("UPDATE tenants SET status = 'suspended' WHERE id = ?", [rows[0].tenant_id]);

                        // Dunning: tell the customer their service is paused (halted = payment retries exhausted)
                        if (event.event === 'subscription.halted') {
                            const tInfo: any = await query('SELECT email, store_name FROM tenants WHERE id = ?', [rows[0].tenant_id]);
                            if (tInfo.length > 0) {
                                const planName = sub.notes?.product === 'hosting' ? 'Hosting' : 'Cataseek Search';
                                sendSubscriptionPausedEmail(tInfo[0].email, tInfo[0].store_name, planName)
                                    .catch((e) => console.error('Paused email error:', e));
                            }
                        }
                    }
                }
                break;
            }

            case 'payment.failed': {
                const payment = event.payload?.payment?.entity;
                if (!payment) break;

                const tenantId = parseInt(payment.notes?.tenant_id || '0');
                if (tenantId) {
                    await recordOrder({
                        tenantId,
                        razorpayPaymentId: payment.id,
                        razorpayOrderId: payment.order_id || null,
                        amount: Number(payment.amount || 0) / 100,
                        currency: payment.currency || config.currency,
                        status: 'failed',
                        method: payment.method || null,
                        email: payment.email || null,
                        contact: payment.contact || null,
                        notes: payment.error_description || 'Payment failed',
                        product: payment.notes?.product === 'hosting' ? 'hosting' : 'search',
                    });

                    // Dunning: notify the customer so they can fix payment before service pauses
                    const tInfo: any = await query('SELECT email, store_name FROM tenants WHERE id = ?', [tenantId]);
                    if (tInfo.length > 0) {
                        const planName = payment.notes?.product === 'hosting' ? 'Hosting' : 'Cataseek Search';
                        sendPaymentFailedEmail(tInfo[0].email, tInfo[0].store_name, planName, payment.error_description || undefined)
                            .catch((e) => console.error('Payment-failed email error:', e));
                    }
                }
                break;
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Razorpay webhook error:', error);
        res.status(500).json({ error: 'Webhook handler failed' });
    }
});

// ─── POST /api/billing/cancel ─────────────────────────────────────────────────
// Cancel the active subscription (at Razorpay too, if linked)
router.post('/cancel', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user.id;
        const subs: any = await query(
            "SELECT id, razorpay_subscription_id FROM subscriptions WHERE tenant_id = ? AND status = 'active' ORDER BY current_period_end DESC LIMIT 1",
            [tenantId]
        );
        if (!subs || subs.length === 0) return res.status(404).json({ error: 'No active subscription found' });

        const sub = subs[0];

        if (sub.razorpay_subscription_id) {
            try {
                const { client } = await getRazorpayClient();
                await client.subscriptions.cancel(sub.razorpay_subscription_id, true); // cancel at cycle end
            } catch (e: any) {
                console.warn('Razorpay cancel warning:', e?.error?.description || e?.message);
            }
        }

        await query("UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?", [sub.id]);
        res.json({ message: 'Subscription cancelled. Access remains until the end of the billing period.' });
    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
});

// ─── POST /api/billing/subscribe ──────────────────────────────────────────────
// Demo-mode subscription (no gateway). Kept as fallback while Razorpay is off.
router.post('/subscribe', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { planId } = req.body;
        const tenantId = req.user.id;

        if (!planId) return res.status(400).json({ error: 'planId is required' });

        // Block demo subscribe when real payments are enabled
        const config = await getRazorpayConfig();
        if (config.enabled && config.key_id) {
            return res.status(400).json({ error: 'Online payment is required. Use the checkout flow.' });
        }

        const plans: any = await query('SELECT * FROM plans WHERE id = ? AND is_active = TRUE', [planId]);
        if (!plans || plans.length === 0) return res.status(404).json({ error: 'Plan not found' });
        const plan = plans[0];

        // Same one-time plan-change credit as the Razorpay flow
        const { credit, oldPlanName } = await getPlanChangeCredit(tenantId);
        const creditApplied = credit > 0 ? Math.min(credit, Number(plan.price) - 1) : 0;
        const firstCharge = Math.round((Number(plan.price) - creditApplied) * 100) / 100;

        const { invoiceNumber, periodEnd } = await activateSubscription({
            tenantId,
            plan,
            currency: 'USD',
            billingReason: creditApplied > 0 ? 'subscription_upgrade' : 'subscription_create',
            amountOverride: firstCharge,
        });

        res.json({
            message: creditApplied > 0
                ? `Successfully subscribed to ${plan.name} — ${creditApplied.toFixed(2)} credit from your unused ${oldPlanName || 'previous'} plan applied to the first charge`
                : `Successfully subscribed to ${plan.name}`,
            invoiceNumber,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            creditApplied,
            firstCharge,
            periodEnd,
        });
    } catch (error) {
        console.error('Billing subscribe error:', error);
        res.status(500).json({ error: 'Failed to process subscription' });
    }
});

export default router;
