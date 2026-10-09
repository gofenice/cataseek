import express, { Response } from 'express';
import crypto from 'crypto';
import { query } from '../config/database';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { generateInvoicePDF } from '../services/pdf.service';
import { sendInvoiceEmail, sendSubscriptionWelcomeEmail } from '../services/mailer.service';
import { getRazorpayConfig, getCompanyConfig } from '../services/payment-settings.service';
import {
    createRazorpaySubscription,
    verifyWebhookSignature,
    recordOrder,
    ensurePaymentTables,
    ensureInvoicesTable,
    getRazorpayClient,
    resolveRazorpayPlanForCheckout,
    PlanMappingError,
} from '../services/razorpay.service';
import {
    BillingError,
    createCheckoutRecord,
    expireEndedSubscriptions,
    findAwaitingFirstCharge,
    makeInvoiceNumber,
    processWebhookEvent,
    remainingTrialEnd,
    requestCancel,
    verifyCheckout,
} from '../services/subscription-lifecycle.service';
import {
    getBaseCurrency,
    localizePlan,
    resolveTenantCurrency,
    setTenantCurrency,
    subscriptionPriceJoin,
} from '../services/currency.service';

const router = express.Router();

// ─── Helper: prorated unused value of the current subscription ────────────────
// Used as a ONE-TIME credit on the first charge when a client changes plan
// mid-cycle. E.g. half of a ₹2,999 month left → ₹1,499.50 off the new plan's
// first payment; full price resumes from the next cycle.
async function getPlanChangeCredit(tenantId: number): Promise<{ credit: number; oldPlanName: string | null }> {
    const subs: any = await query(
        `SELECT s.current_period_start, s.current_period_end, COALESCE(cp.price, p.price) AS price, p.name
         FROM subscriptions s
         JOIN plans p ON s.plan_id = p.id
         ${subscriptionPriceJoin('plans', 'p', 's', 'cp')}
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

// ─── Helper: normalize price to a monthly-equivalent for upgrade/downgrade comparison ──
function effectiveMonthlyPrice(price: number | string, billingPeriod: string): number {
    return Number(price) / (billingPeriod === 'yearly' ? 12 : 1);
}

// ─── Helper: this tenant's current active subscription + plan details ─────────
async function getActiveSubscriptionWithPlan(tenantId: number): Promise<any | null> {
    const subs: any = await query(
        `SELECT s.id, s.current_period_end, s.razorpay_subscription_id, s.gateway_status, s.cancel_at_period_end, s.currency, s.pending_plan_id,
                p.id AS plan_id, p.name AS plan_name, COALESCE(cp.price, p.price) AS price, p.billing_period
         FROM subscriptions s
         JOIN plans p ON s.plan_id = p.id
         ${subscriptionPriceJoin('plans', 'p', 's', 'cp')}
         WHERE s.tenant_id = ? AND s.status = 'active'
           AND NOT (s.cancel_at_period_end = 1 AND s.current_period_end <= NOW())
         ORDER BY s.current_period_end DESC LIMIT 1`,
        [tenantId]
    );
    return subs && subs.length > 0 ? subs[0] : null;
}

// ─── Demo mode: activate a subscription for a tenant ──────────────────────────
// Used by demo subscribe and demo deferred downgrades only. Razorpay-backed
// subscriptions go through subscription-lifecycle.service (verify + webhooks).
async function activateSubscription(opts: {
    tenantId: number;
    plan: any;
    currency?: string;
    billingReason?: string;
    razorpaySubscriptionId?: string | null;
    amountOverride?: number; // actual amount paid (e.g. first charge after plan-change credit)
}) {
    const { tenantId, plan } = opts;
    const currency = opts.currency || plan.currency || 'USD';
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
        `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end, razorpay_subscription_id, currency)
         VALUES (?, ?, 'active', ?, ?, ?, ?)`,
        [tenantId, plan.id, periodStart, periodEnd, opts.razorpaySubscriptionId || null, currency]
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
            sendInvoiceEmail(tenant.email, tenant.store_name, invoiceNumber, plan.name, invoiceAmount, pdfBuffer, currency)
        )
        .catch((e) => console.error('Invoice email error:', e));

    sendSubscriptionWelcomeEmail(tenant.email, tenant.store_name, plan.name, parseFloat(plan.price), periodEnd, currency)
        .catch((e) => console.error('Welcome email error:', e));

    return { invoiceNumber, periodStart, periodEnd, tenant };
}

// ─── Deferred downgrades: apply a scheduled plan swap once current_period_end has passed ──
// Only for subscriptions with NO gateway subscription (demo mode / no recurring engine).
// Razorpay-linked subscriptions are switched by the gateway itself (schedule_change_at:
// 'cycle_end', set in POST /downgrade) and picked up by the 'subscription.charged' webhook —
// running this for those too would double-invoice the renewal.
export async function applyDuePlanChange(tenantId: number): Promise<void> {
    const sub = await getActiveSubscriptionWithPlan(tenantId);
    if (!sub) return;

    const subs: any = await query(
        'SELECT pending_plan_id, pending_plan_change_at FROM subscriptions WHERE id = ?',
        [sub.id]
    );
    const pendingPlanId = subs?.[0]?.pending_plan_id;
    const pendingChangeAt = subs?.[0]?.pending_plan_change_at;
    if (!pendingPlanId || !pendingChangeAt) return;
    if (sub.razorpay_subscription_id) return; // gateway-managed — webhook handles it
    if (new Date(pendingChangeAt).getTime() > Date.now()) return;

    const plans: any = await query('SELECT * FROM plans WHERE id = ?', [pendingPlanId]);
    if (!plans || plans.length === 0) return;
    // Stays in the currency of the subscription being replaced
    const plan = (await localizePlan('plans', plans[0], sub.currency)) || (await localizePlan('plans', plans[0]));

    await activateSubscription({
        tenantId,
        plan,
        currency: plan.currency,
        billingReason: 'subscription_downgrade',
    });
}

// ─── GET /api/billing/payment-config ──────────────────────────────────────────
// Tells the dashboard which gateway to use for checkout
router.get('/payment-config', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const config = await getRazorpayConfig();
        const razorpayReady = config.enabled && !!config.key_id && !!config.key_secret;
        await ensurePaymentTables();
        const billing = await resolveTenantCurrency(req.user.id, req);
        res.json({
            gateway: razorpayReady ? 'razorpay' : 'demo',
            key_id: razorpayReady ? config.key_id : null,
            currency: billing.currency,
            currencyLocked: billing.locked,
            currencyOptions: billing.options,
            mode: config.mode,
        });
    } catch (error) {
        console.error('Payment config error:', error);
        res.json({ gateway: 'demo', key_id: null, currency: 'USD', currencyLocked: true, currencyOptions: ['USD'], mode: 'test' });
    }
});

// ─── PUT /api/billing/currency ────────────────────────────────────────────────
// Currency switcher. The currency follows the visitor's country by default; a
// card issued elsewhere needs another one (Razorpay only charges Indian cards in
// INR and foreign cards in the other currencies). Fixed while a subscription runs.
router.put('/currency', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const currency = String(req.body?.currency || '').toUpperCase();
        await ensurePaymentTables();
        const billing = await resolveTenantCurrency(req.user.id, req);
        if (!billing.options.includes(currency)) {
            return res.status(400).json({ error: 'That currency is not available' });
        }
        if (billing.locked && currency !== billing.currency) {
            return res.status(400).json({ error: `Your subscription is billed in ${billing.currency}. Cancel it first to switch currency.` });
        }
        await setTenantCurrency(req.user.id, currency);
        res.json({ currency });
    } catch (error) {
        console.error('Currency switch error:', error);
        res.status(500).json({ error: 'Failed to change currency' });
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
// Step 1 of checkout: create a Razorpay subscription for the chosen plan and a
// local 'incomplete' row for it; return the id so the dashboard can open Checkout.
//   trial     — tenant still in its free trial: first charge at trial end
//   upgrade   — plan change with unused-value credit: discounted first cycle now
//   immediate — everything else: charged now
router.post('/razorpay/subscribe', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { planId } = req.body;
        const tenantId = req.user.id;

        if (!planId) return res.status(400).json({ error: 'planId is required' });

        const config = await getRazorpayConfig();
        if (!config.enabled) return res.status(400).json({ error: 'Online payments are not enabled' });

        await ensurePaymentTables();
        await expireEndedSubscriptions(tenantId);

        const plans: any = await query('SELECT * FROM plans WHERE id = ? AND is_active = TRUE', [planId]);
        if (!plans || plans.length === 0) return res.status(404).json({ error: 'Plan not found' });

        // A bank mandate from an earlier checkout is still waiting for its first debit
        if (await findAwaitingFirstCharge('search', tenantId)) {
            return res.status(400).json({ error: 'Your bank is still processing the first payment of your previous checkout. Your plan activates as soon as it is collected — please wait before starting another one.' });
        }

        // The plan as sold in this tenant's billing currency
        const billing = await resolveTenantCurrency(tenantId, req);
        const plan = await localizePlan('plans', plans[0], billing.currency);
        if (!plan) return res.status(409).json({ error: `This plan is not available in ${billing.currency} yet. Please contact support.` });

        // Downgrades are deferred to current_period_end (POST /downgrade), not
        // switched immediately — this endpoint is upgrade/new-subscription only.
        const existingSub = await getActiveSubscriptionWithPlan(tenantId);
        if (existingSub && Number(existingSub.plan_id) === Number(plan.id) && !existingSub.cancel_at_period_end) {
            return res.status(400).json({ error: 'You are already on this plan' });
        }
        if (existingSub && effectiveMonthlyPrice(plan.price, plan.billing_period) < effectiveMonthlyPrice(existingSub.price, existingSub.billing_period)) {
            return res.status(400).json({ error: 'Use POST /api/billing/downgrade to schedule a plan downgrade.' });
        }

        // During the trial a DIFFERENT plan replaces the scheduled one (handled on
        // authentication); the SAME plan again would only open a duplicate mandate.
        const scheduled: any = await query(
            "SELECT id FROM subscriptions WHERE tenant_id = ? AND status = 'trialing' AND plan_id = ? LIMIT 1",
            [tenantId, plan.id]
        );
        if (scheduled.length > 0) {
            return res.status(400).json({ error: 'This plan is already scheduled to start on your next billing date.' });
        }

        const tenants: any = await query('SELECT id, store_name, email, status, trial_ends_at FROM tenants WHERE id = ?', [tenantId]);
        const tenant = tenants[0];

        // Free trial: keep the remaining trial days — the subscription starts
        // (first charge) when the trial ends; checkout only authorises the card.
        const trialEnd = existingSub ? null : remainingTrialEnd(tenant);

        // One-time plan-change credit: unused value of the current subscription
        // is deducted from the FIRST charge; recurring full price starts next cycle.
        const { credit, oldPlanName } = trialEnd ? { credit: 0, oldPlanName: null } : await getPlanChangeCredit(tenantId);
        const creditApplied = credit > 0 ? Math.min(credit, Number(plan.price) - 1) : 0;
        const firstCharge = trialEnd ? 0 : Math.round((Number(plan.price) - creditApplied) * 100) / 100;

        let subscription: any;
        let checkoutType: 'immediate' | 'trial' | 'upgrade' = 'immediate';
        let startsAt: Date | null = null;

        if (trialEnd) {
            checkoutType = 'trial';
            startsAt = trialEnd;
            subscription = await createRazorpaySubscription(tenant, plan, {
                product: 'search',
                checkoutType,
                startAt: Math.floor(trialEnd.getTime() / 1000),
            });
        } else if (creditApplied > 0) {
            // Recurring mandate starts next cycle; discounted first cycle collected now
            checkoutType = 'upgrade';
            const startAt = new Date();
            if (plan.billing_period === 'yearly') startAt.setFullYear(startAt.getFullYear() + 1);
            else startAt.setMonth(startAt.getMonth() + 1);
            startsAt = startAt;

            subscription = await createRazorpaySubscription(tenant, plan, {
                product: 'search',
                checkoutType,
                startAt: Math.floor(startAt.getTime() / 1000),
                upfront: {
                    amount: firstCharge,
                    label: `${plan.name} Plan — first cycle (credit from ${oldPlanName || 'previous plan'} applied)`,
                },
            });
        } else {
            subscription = await createRazorpaySubscription(tenant, plan, { product: 'search', checkoutType });
        }

        await createCheckoutRecord({
            product: 'search',
            tenantId,
            planId: plan.id,
            razorpaySubscriptionId: subscription.id,
            checkoutType,
            startsAt,
            currency: plan.currency,
        });

        // Record a pending order so we can track abandoned checkouts too
        await recordOrder({
            tenantId,
            planId: plan.id,
            planName: plan.name,
            razorpaySubscriptionId: subscription.id,
            amount: firstCharge,
            currency: plan.currency,
            status: 'created',
            email: tenant.email,
            notes: checkoutType === 'trial'
                ? `Trial checkout initiated (first charge ${startsAt!.toISOString()})`
                : creditApplied > 0 ? `Checkout initiated (plan-change credit ${creditApplied} applied)` : 'Checkout initiated',
        });

        res.json({
            subscriptionId: subscription.id,
            keyId: config.key_id,
            currency: plan.currency,
            plan: { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period },
            checkoutType,
            firstChargeAt: startsAt,
            creditApplied,
            firstCharge,
            prefill: { email: tenant.email, name: tenant.store_name },
        });
    } catch (error: any) {
        if (error instanceof PlanMappingError) {
            console.error('Razorpay plan mapping error:', error.message);
            return res.status(409).json({ error: 'This plan is not available for online payment yet. Please contact support.' });
        }
        console.error('Razorpay subscribe error:', error);
        const detail = error?.error?.description || error?.message;
        res.status(500).json({ error: detail || 'Failed to start checkout' });
    }
});

// ─── POST /api/billing/razorpay/verify ────────────────────────────────────────
// Step 2 of checkout: Razorpay Checkout returns payment_id + subscription_id +
// signature. The plan is taken from the Razorpay subscription, never the body.
router.post('/razorpay/verify', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
        if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment verification fields' });
        }

        const r = await verifyCheckout({
            product: 'search',
            tenantId: req.user.id,
            paymentId: razorpay_payment_id,
            subscriptionId: razorpay_subscription_id,
            signature: razorpay_signature,
        });
        const plan = r.plan;
        const planInfo = { id: plan.id, name: plan.name, price: plan.price, billing_period: plan.billing_period };

        if (r.awaitingFirstCharge) {
            return res.json({
                message: `Your bank mandate is set up. ${plan.name} activates as soon as the first payment is collected from your bank account — usually within 1–2 working days. You'll receive the invoice by email.`,
                checkoutType: r.checkoutType,
                awaitingFirstCharge: true,
                plan: planInfo,
                currency: plan.currency,
            });
        }

        if (r.checkoutType === 'downgrade') {
            const when = r.startsAt ? new Date(r.startsAt).toLocaleDateString() : 'your renewal date';
            return res.json({
                message: `Downgrade to ${plan.name} scheduled — your current plan continues until ${when}, then ${plan.name} starts and is charged.`,
                checkoutType: r.checkoutType,
                plan: planInfo,
                firstChargeAt: r.startsAt,
                firstCharge: 0,
                creditApplied: 0,
                currency: plan.currency,
            });
        }

        if (r.checkoutType === 'trial') {
            return res.json({
                message: `${plan.name} plan scheduled — your free trial continues and your first payment is on ${r.startsAt ? new Date(r.startsAt).toLocaleDateString() : 'the day your trial ends'}.`,
                checkoutType: r.checkoutType,
                plan: planInfo,
                firstChargeAt: r.startsAt,
                firstCharge: 0,
                creditApplied: 0,
                currency: plan.currency,
            });
        }

        const amount = r.amount ?? Number(plan.price);
        const creditApplied = Math.max(0, Math.round((Number(plan.price) - amount) * 100) / 100);
        res.json({
            message: creditApplied > 0
                ? `Successfully subscribed to ${plan.name} — ${creditApplied.toFixed(2)} credit from your previous plan applied to the first charge`
                : `Successfully subscribed to ${plan.name}`,
            checkoutType: r.checkoutType,
            invoiceNumber: r.invoiceNumber,
            plan: planInfo,
            creditApplied,
            firstCharge: amount,
            periodEnd: r.periodEnd,
            currency: plan.currency,
        });
    } catch (error: any) {
        if (error instanceof BillingError) return res.status(error.status).json({ error: error.message });
        console.error('Razorpay verify error:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

// ─── POST /api/billing/razorpay/webhook ───────────────────────────────────────
// Handles charges + lifecycle events for search AND hosting subscriptions.
// Mounted with express.raw in server.ts so the signature is checked against the
// raw body. Each x-razorpay-event-id is processed once (Razorpay delivers
// at-least-once); a failure answers 500 so Razorpay retries it.
router.post('/razorpay/webhook', async (req: AuthRequest, res: Response) => {
    const config = await getRazorpayConfig().catch(() => null);
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    if (!config?.webhook_secret) {
        console.error('[Razorpay webhook] no webhook secret configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    if (!signature || rawBody.length === 0 || !verifyWebhookSignature(rawBody, signature, config.webhook_secret)) {
        return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventId = String(req.headers['x-razorpay-event-id'] || '')
        || crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 64);
    const entityId = event?.payload?.subscription?.entity?.id || event?.payload?.payment?.entity?.id || null;

    try {
        await ensurePaymentTables();

        // Claim the event. A processed event is acknowledged without re-running;
        // one still being processed by a concurrent delivery is retried later.
        const claim: any = await query(
            'INSERT IGNORE INTO razorpay_webhook_events (event_id, event, entity_id) VALUES (?, ?, ?)',
            [eventId, event?.event || 'unknown', entityId]
        );
        if (claim.affectedRows === 0) {
            const rows: any = await query('SELECT status, updated_at FROM razorpay_webhook_events WHERE event_id = ?', [eventId]);
            const prev = rows?.[0];
            if (prev?.status === 'processed') {
                return res.json({ received: true, duplicate: true });
            }
            const stale = prev?.status === 'failed'
                || (prev?.status === 'processing' && Date.now() - new Date(prev.updated_at).getTime() > 2 * 60 * 1000);
            const reclaimed: any = stale
                ? await query(
                    "UPDATE razorpay_webhook_events SET status = 'processing', attempts = attempts + 1 WHERE event_id = ? AND status = ?",
                    [eventId, prev.status]
                )
                : { affectedRows: 0 };
            if (reclaimed.affectedRows === 0) {
                return res.status(409).json({ error: 'Event is already being processed' });
            }
        }

        const outcome = await processWebhookEvent(event);
        await query(
            "UPDATE razorpay_webhook_events SET status = 'processed', processed_at = NOW(), last_error = NULL WHERE event_id = ?",
            [eventId]
        );
        console.log(`[Razorpay webhook] ${event.event} ${entityId || ''} → ${outcome}`);
        res.json({ received: true });
    } catch (error: any) {
        console.error(`[Razorpay webhook] ${event?.event} failed:`, error);
        await query(
            "UPDATE razorpay_webhook_events SET status = 'failed', last_error = ? WHERE event_id = ?",
            [String(error?.message || error).slice(0, 2000), eventId]
        ).catch(() => { /* best effort */ });
        res.status(500).json({ error: 'Webhook handler failed' });
    }
});

// Razorpay's answers when a subscription paid with an Indian card or UPI is asked to change plan
// ("…when payment mode is domestic card", "…when payment mode is upi", "…card mandate is applicable")
const DOMESTIC_CARD_UPDATE_REFUSED = /payment mode is|card mandate/i;

// Downgrade for Indian-card subscriptions: a new Razorpay subscription on the lower
// plan, first charge at the current period end, opened in Checkout like a trial
// (the card is verified with a refunded token amount). The current subscription is
// only stopped once this one is authorised — see scheduleReplacement.
async function startReplacementDowngrade(req: AuthRequest, res: Response, sub: any, newPlan: any) {
    const tenantId = req.user.id;
    const startsAt = new Date(sub.current_period_end);
    if (startsAt.getTime() - Date.now() < 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Your plan renews within the hour. Please schedule the downgrade after the renewal.' });
    }
    const config = await getRazorpayConfig();
    const tenants: any = await query('SELECT id, store_name, email FROM tenants WHERE id = ?', [tenantId]);
    const tenant = tenants[0];
    try {
        const subscription = await createRazorpaySubscription(tenant, newPlan, {
            product: 'search',
            checkoutType: 'downgrade',
            startAt: Math.floor(startsAt.getTime() / 1000),
        });
        await createCheckoutRecord({
            product: 'search', tenantId, planId: newPlan.id, razorpaySubscriptionId: subscription.id,
            checkoutType: 'downgrade', startsAt, currency: newPlan.currency,
        });
        await recordOrder({
            tenantId, planId: newPlan.id, planName: newPlan.name, razorpaySubscriptionId: subscription.id,
            amount: 0, currency: newPlan.currency, status: 'created', email: tenant.email,
            notes: `Downgrade checkout initiated (first charge ${startsAt.toISOString()})`,
        });
        return res.json({
            requiresCheckout: true,
            subscriptionId: subscription.id,
            keyId: config.key_id,
            currency: newPlan.currency,
            plan: { id: newPlan.id, name: newPlan.name, price: newPlan.price, billing_period: newPlan.billing_period },
            checkoutType: 'downgrade',
            firstChargeAt: startsAt,
            prefill: { email: tenant.email, name: tenant.store_name },
        });
    } catch (e: any) {
        if (e instanceof PlanMappingError) {
            console.error('Razorpay plan mapping error:', e.message);
            return res.status(409).json({ error: 'This plan is not available for online payment yet. Please contact support.' });
        }
        console.error('Replacement downgrade error:', e?.error?.description || e?.message);
        return res.status(500).json({ error: 'Could not schedule the downgrade with the payment gateway. Please try again.' });
    }
}

// ─── POST /api/billing/downgrade ───────────────────────────────────────────────
// Defers a plan-change to a cheaper plan until current_period_end instead of
// switching immediately: no proration credit, no invoice, no refund. The
// customer keeps their current plan/features/limits until the renewal date,
// at which point the subscription switches over automatically and billing
// resumes at the new (lower) plan price.
router.post('/downgrade', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { planId } = req.body;
        const tenantId = req.user.id;

        if (!planId) return res.status(400).json({ error: 'planId is required' });

        const newPlans: any = await query('SELECT * FROM plans WHERE id = ? AND is_active = TRUE', [planId]);
        if (!newPlans || newPlans.length === 0) return res.status(404).json({ error: 'Plan not found' });

        await ensurePaymentTables();
        const sub = await getActiveSubscriptionWithPlan(tenantId);
        if (!sub) return res.status(404).json({ error: 'No active subscription found' });

        // A plan change keeps the subscription's currency
        const subCurrency = sub.currency || await getBaseCurrency();
        const newPlan = await localizePlan('plans', newPlans[0], subCurrency);
        if (!newPlan) return res.status(409).json({ error: `This plan is not available in ${subCurrency}. Please contact support.` });

        if (sub.cancel_at_period_end) {
            const msg = sub.pending_plan_id
                ? `A change to another plan is already scheduled for ${new Date(sub.current_period_end).toLocaleDateString()}. Cancel your subscription first to choose a different one.`
                : `Your subscription is cancelled and ends on ${new Date(sub.current_period_end).toLocaleDateString()}. You can choose a new plan once it ends.`;
            return res.status(400).json({ error: msg });
        }

        if (Number(newPlan.id) === Number(sub.plan_id)) {
            return res.status(400).json({ error: 'You are already on this plan' });
        }

        const currentEffective = effectiveMonthlyPrice(sub.price, sub.billing_period);
        const newEffective = effectiveMonthlyPrice(newPlan.price, newPlan.billing_period);
        if (newEffective >= currentEffective) {
            return res.status(400).json({ error: 'This is not a downgrade — use the regular checkout to switch plans.' });
        }

        // Gateway-linked subscription: schedule the plan swap at Razorpay too so the
        // next auto-charge bills the new (lower) plan. The renewal webhook maps the
        // charged Razorpay plan back to the new Cataseek plan.
        //   active        → swap at cycle_end (the current Razorpay cycle is paid)
        //   authenticated → prepaid plan-change subscription whose first recurring
        //                   charge is at current_period_end: no Razorpay cycle has
        //                   started yet, so swap 'now' — that first charge is then
        //                   already on the lower plan.
        if (sub.razorpay_subscription_id) {
            if (sub.gateway_status === 'created') {
                return res.status(400).json({ error: 'Your subscription is still being set up with the payment gateway. Please try again in a few minutes.' });
            }
            const scheduleChangeAt = sub.gateway_status === 'authenticated' ? 'now' : 'cycle_end';
            // Razorpay rejects `notes` on a plan update ("notes is/are not required");
            // the subscription keeps its original notes, so the new plan is resolved
            // from the charged Razorpay plan_id via the plan mapping, not from notes.
            try {
                const { client } = await getRazorpayClient();
                const rzpPlanId = await resolveRazorpayPlanForCheckout(newPlan, 'plans');
                await client.subscriptions.update(sub.razorpay_subscription_id, {
                    plan_id: rzpPlanId,
                    schedule_change_at: scheduleChangeAt,
                } as any);
            } catch (e: any) {
                const detail = e?.error?.description || e?.message || '';
                // Indian (domestic) card and UPI subscriptions can't change plan at Razorpay —
                // replace them: the customer authorises a new subscription on the
                // lower plan that starts when the current paid period ends.
                if (DOMESTIC_CARD_UPDATE_REFUSED.test(detail)) {
                    return startReplacementDowngrade(req, res, sub, newPlan);
                }
                console.error('Razorpay downgrade schedule error:', detail);
                return res.status(500).json({ error: 'Could not schedule the downgrade with the payment gateway. Please try again.' });
            }
        }

        await query(
            'UPDATE subscriptions SET pending_plan_id = ?, pending_plan_change_at = ? WHERE id = ?',
            [newPlan.id, sub.current_period_end, sub.id]
        );

        const renewalDate = new Date(sub.current_period_end).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
        });

        res.json({
            message: `Your downgrade to ${newPlan.name} has been scheduled and will take effect on ${renewalDate}. You will continue to enjoy your current plan benefits until then.`,
            scheduledPlan: { id: newPlan.id, name: newPlan.name, price: newPlan.price, billing_period: newPlan.billing_period, currency: newPlan.currency },
            effectiveDate: sub.current_period_end,
        });
    } catch (error) {
        console.error('Schedule downgrade error:', error);
        res.status(500).json({ error: 'Failed to schedule downgrade' });
    }
});

// ─── POST /api/billing/cancel ─────────────────────────────────────────────────
// Paid plan: cancelled at Razorpay at cycle end, access until current_period_end.
// Trial-scheduled plan: cancelled immediately, nothing is charged.
router.post('/cancel', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        const r = await requestCancel('search', req.user.id);
        res.json({ message: r.message, accessUntil: r.accessUntil });
    } catch (error: any) {
        if (error instanceof BillingError) return res.status(error.status).json({ error: error.message });
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

        await ensurePaymentTables();
        const billing = await resolveTenantCurrency(tenantId, req);
        const plan = await localizePlan('plans', plans[0], billing.currency);
        if (!plan) return res.status(409).json({ error: `This plan is not available in ${billing.currency} yet. Please contact support.` });

        // Downgrades are deferred to current_period_end (POST /downgrade), not
        // switched immediately — this endpoint is upgrade/new-subscription only.
        const existingSub = await getActiveSubscriptionWithPlan(tenantId);
        if (existingSub && effectiveMonthlyPrice(plan.price, plan.billing_period) < effectiveMonthlyPrice(existingSub.price, existingSub.billing_period)) {
            return res.status(400).json({ error: 'Use POST /api/billing/downgrade to schedule a plan downgrade.' });
        }

        // Same one-time plan-change credit as the Razorpay flow
        const { credit, oldPlanName } = await getPlanChangeCredit(tenantId);
        const creditApplied = credit > 0 ? Math.min(credit, Number(plan.price) - 1) : 0;
        const firstCharge = Math.round((Number(plan.price) - creditApplied) * 100) / 100;

        const { invoiceNumber, periodEnd } = await activateSubscription({
            tenantId,
            plan,
            currency: plan.currency,
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
            currency: plan.currency,
        });
    } catch (error) {
        console.error('Billing subscribe error:', error);
        res.status(500).json({ error: 'Failed to process subscription' });
    }
});

export default router;
