import { query } from '../config/database';
import { getRazorpayConfig, getCompanyConfig } from './payment-settings.service';
import { generateInvoicePDF } from './pdf.service';
import { sendInvoiceEmail, sendSubscriptionWelcomeEmail, sendSubscriptionPausedEmail, sendPaymentFailedEmail } from './mailer.service';
import {
    ensurePaymentTables,
    findLocalPlanByRazorpayPlanId,
    getRazorpayClient,
    recordOrder,
    verifySubscriptionSignature,
    PlanTable,
} from './razorpay.service';
import { ensureHostingTables } from './hosting.service';
import { invalidateTenantApiCache, invalidateTenantPlanCache } from '../middleware/auth';

// ─── Razorpay subscription lifecycle (search + hosting) ───────────────────────
// One local row per Razorpay subscription. It is created as 'incomplete' when
// checkout starts and then only UPDATED: verify, renewals and webhook state
// changes all converge on the same row, so retries, duplicate deliveries and
// the verify/webhook race cannot create extra subscriptions or invoices.
//
// Local `status` = what the customer can access:
//   incomplete → checkout started, nothing authorised yet
//   trialing   → mandate authorised during the free trial; first charge at starts_at
//   active     → paid (cancel_at_period_end = access until current_period_end)
//   past_due   → halted / paused at Razorpay, access removed
//   cancelled  → ended
// `gateway_status` mirrors Razorpay's own status (created, authenticated,
// active, pending, halted, paused, cancelled, completed, expired).

export type Product = 'search' | 'hosting';
export type CheckoutType = 'immediate' | 'trial' | 'upgrade';

interface ProductConfig {
    subTable: 'subscriptions' | 'hosting_subscriptions';
    planTable: PlanTable;
    planFk: 'plan_id' | 'hosting_plan_id';
    serviceName: string; // used in dunning emails
    invoicePlanName: (plan: any) => string;
    lineDescription: (plan: any) => string;
}

export const PRODUCTS: Record<Product, ProductConfig> = {
    search: {
        subTable: 'subscriptions',
        planTable: 'plans',
        planFk: 'plan_id',
        serviceName: 'Cataseek Search',
        invoicePlanName: (plan) => plan.name,
        lineDescription: (plan) => `${plan.name} Plan`,
    },
    hosting: {
        subTable: 'hosting_subscriptions',
        planTable: 'hosting_plans',
        planFk: 'hosting_plan_id',
        serviceName: 'Hosting',
        invoicePlanName: (plan) => `Hosting — ${plan.name}`,
        lineDescription: (plan) => `Hosting — ${plan.name} (${plan.storage_gb}GB storage · ${plan.ram_gb}GB RAM · ${plan.bandwidth} data)`,
    },
};

const TERMINAL_GATEWAY_STATUSES = new Set(['cancelled', 'completed', 'expired']);

export class BillingError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function makeInvoiceNumber(id: number): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${String(id).padStart(5, '0')}`;
}

function unixToDate(seconds?: number | string | null): Date | null {
    const n = Number(seconds);
    return n > 0 ? new Date(n * 1000) : null;
}

export function addBillingPeriod(from: Date, billingPeriod: string): Date {
    const d = new Date(from);
    if (billingPeriod === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d;
}

async function ensureTables(product: Product) {
    await ensurePaymentTables();
    if (product === 'hosting') await ensureHostingTables();
}

export async function invalidateTenantCaches(tenantId: number) {
    invalidateTenantPlanCache(tenantId);
    try {
        const rows: any = await query('SELECT api_key FROM tenants WHERE id = ?', [tenantId]);
        if (rows?.[0]?.api_key) invalidateTenantApiCache(rows[0].api_key);
    } catch (_) { /* cache eviction is best-effort */ }
}

export async function findSubscriptionByGatewayId(product: Product, razorpaySubscriptionId: string): Promise<any | null> {
    const { subTable } = PRODUCTS[product];
    const rows: any = await query(
        `SELECT * FROM ${subTable} WHERE razorpay_subscription_id = ? ORDER BY id DESC LIMIT 1`,
        [razorpaySubscriptionId]
    );
    return rows?.[0] || null;
}

async function resolveProduct(rzpSub: any): Promise<Product> {
    if (rzpSub?.notes?.product === 'hosting') return 'hosting';
    if (rzpSub?.notes?.product === 'search') return 'search';
    await ensureHostingTables();
    return (await findSubscriptionByGatewayId('hosting', rzpSub?.id)) ? 'hosting' : 'search';
}

async function loadPlan(table: PlanTable, id: number): Promise<any | null> {
    if (!id) return null;
    const rows: any = await query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    return rows?.[0] || null;
}

// ─── Checkout record ──────────────────────────────────────────────────────────
export async function createCheckoutRecord(o: {
    product: Product;
    tenantId: number;
    planId: number;
    razorpaySubscriptionId: string;
    checkoutType: CheckoutType;
    startsAt?: Date | null;
}): Promise<number> {
    await ensureTables(o.product);
    const { subTable, planFk } = PRODUCTS[o.product];
    const result: any = await query(
        `INSERT INTO ${subTable} (tenant_id, ${planFk}, status, razorpay_subscription_id, gateway_status, checkout_type, starts_at)
         VALUES (?, ?, 'incomplete', ?, 'created', ?, ?)`,
        [o.tenantId, o.planId, o.razorpaySubscriptionId, o.checkoutType, o.startsAt || null]
    );
    return result.insertId;
}

// ─── Invoice (one per gateway payment) ────────────────────────────────────────
async function issueInvoice(o: {
    tenantId: number;
    planName: string;
    lineDescription: string;
    amount: number;
    currency: string;
    billingReason: string;
    periodStart: Date;
    periodEnd: Date;
    gatewayPaymentId: string;
}): Promise<{ invoiceNumber: string; created: boolean }> {
    let invoiceId: number;
    try {
        const result: any = await query(
            `INSERT INTO invoices (tenant_id, invoice_number, plan_name, billing_reason, amount, currency, status, period_start, period_end, paid_at, gateway_payment_id)
             VALUES (?, 'TEMP', ?, ?, ?, ?, 'paid', ?, ?, NOW(), ?)`,
            [o.tenantId, o.planName, o.billingReason, o.amount, o.currency, o.periodStart, o.periodEnd, o.gatewayPaymentId]
        );
        invoiceId = result.insertId;
    } catch (e: any) {
        if (e?.code !== 'ER_DUP_ENTRY') throw e;
        const existing: any = await query('SELECT id, invoice_number FROM invoices WHERE gateway_payment_id = ?', [o.gatewayPaymentId]);
        const row = existing?.[0];
        return { invoiceNumber: row?.invoice_number === 'TEMP' ? makeInvoiceNumber(row.id) : row?.invoice_number, created: false };
    }

    const invoiceNumber = makeInvoiceNumber(invoiceId);
    await query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [invoiceNumber, invoiceId]);

    // PDF + email (fire-and-forget)
    const tenants: any = await query('SELECT store_name, email FROM tenants WHERE id = ?', [o.tenantId]);
    const tenant = tenants?.[0];
    if (tenant) {
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
            currency: o.currency,
            lineItems: [{
                description: o.lineDescription,
                period: `${o.periodStart.toLocaleDateString()} – ${o.periodEnd.toLocaleDateString()}`,
                amount: o.amount,
            }],
        })
            .then((pdfBuffer) => sendInvoiceEmail(tenant.email, tenant.store_name, invoiceNumber, o.planName, o.amount, pdfBuffer))
            .catch((e) => console.error('Invoice email error:', e));
    }

    return { invoiceNumber, created: true };
}

// ─── Replace older subscriptions when a new one takes over ────────────────────
// Stops the old recurring mandate at Razorpay too, otherwise it keeps charging
// the replaced subscription (double billing).
async function cancelOtherSubscriptions(product: Product, tenantId: number, keepRowId: number, keepGatewayId: string | null) {
    const { subTable } = PRODUCTS[product];
    const others: any = await query(
        `SELECT id, razorpay_subscription_id FROM ${subTable}
         WHERE tenant_id = ? AND id <> ? AND status IN ('active','trialing','past_due')`,
        [tenantId, keepRowId]
    );
    for (const old of others) {
        if (old.razorpay_subscription_id && old.razorpay_subscription_id !== keepGatewayId) {
            try {
                const { client } = await getRazorpayClient();
                await client.subscriptions.cancel(old.razorpay_subscription_id, false); // immediate — replaced
            } catch (e: any) {
                console.warn(`Replaced subscription ${old.razorpay_subscription_id} gateway cancel warning:`, e?.error?.description || e?.message);
            }
        }
        await query(
            `UPDATE ${subTable} SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), cancel_at_period_end = 0 WHERE id = ?`,
            [old.id]
        );
    }
}

// Search product: a tenant without any subscription granting access is suspended
// (trial tenants are governed by trial_ends_at and left alone).
async function suspendTenantIfNoAccess(product: Product, tenantId: number): Promise<boolean> {
    if (product !== 'search') return false;
    const still: any = await query(
        `SELECT id FROM subscriptions
         WHERE tenant_id = ? AND (status = 'trialing' OR (status = 'active' AND NOT (cancel_at_period_end = 1 AND current_period_end <= NOW())))
         LIMIT 1`,
        [tenantId]
    );
    if (still.length > 0) return false;
    const result: any = await query("UPDATE tenants SET status = 'suspended' WHERE id = ? AND status = 'active'", [tenantId]);
    return result.affectedRows > 0;
}

// ─── Successful charge (first payment, renewal, upfront plan-change payment) ──
export async function recordCharge(o: {
    product: Product;
    rzpSub: any;
    payment: any;
    eventAt: number;
    period?: { start: Date; end: Date }; // override — prepaid upfront cycle
    billingReason?: string;
    notes?: string;
}): Promise<{ duplicate: boolean; invoiceNumber: string; plan: any; periodStart: Date; periodEnd: Date; amount: number; currency: string }> {
    const { product, rzpSub, payment, eventAt } = o;
    const cfg = PRODUCTS[product];
    await ensureTables(product);
    const config = await getRazorpayConfig();

    let row = await findSubscriptionByGatewayId(product, rzpSub.id);

    // The Razorpay subscription's plan is the source of truth for what was bought
    let plan = await findLocalPlanByRazorpayPlanId(config.mode, cfg.planTable, rzpSub.plan_id);
    if (!plan) {
        const fallbackId = row ? Number(row[cfg.planFk]) : parseInt(rzpSub.notes?.plan_id || '0');
        plan = await loadPlan(cfg.planTable, fallbackId);
        if (plan) console.warn(`[billing] Razorpay plan ${rzpSub.plan_id} is not mapped (${config.mode}); using ${cfg.planTable} #${plan.id}`);
    }
    if (!plan) throw new Error(`Cannot resolve the plan for Razorpay subscription ${rzpSub.id}`);

    if (!row) {
        // Subscription unknown locally (e.g. created before this code) — adopt it
        const tenantId = parseInt(rzpSub.notes?.tenant_id || '0');
        if (!tenantId) throw new Error(`Razorpay subscription ${rzpSub.id} has no tenant_id note`);
        await createCheckoutRecord({
            product, tenantId, planId: plan.id, razorpaySubscriptionId: rzpSub.id,
            checkoutType: (rzpSub.notes?.checkout_type as CheckoutType) || 'immediate',
            startsAt: unixToDate(rzpSub.start_at),
        });
        row = await findSubscriptionByGatewayId(product, rzpSub.id);
    }
    const tenantId = Number(row.tenant_id);

    const isFirstActivation = row.status === 'incomplete' || row.status === 'trialing';
    const replacedLocally = row.status === 'cancelled';
    const planChanged = !isFirstActivation && Number(row[cfg.planFk]) !== Number(plan.id);

    const periodStart = o.period?.start || unixToDate(rzpSub.current_start) || new Date();
    const periodEnd = o.period?.end || unixToDate(rzpSub.current_end) || addBillingPeriod(periodStart, plan.billing_period);
    const amount = Math.round(Number(payment?.amount || 0)) / 100;
    const currency = String(payment?.currency || config.currency).toUpperCase();

    const billingReason = o.billingReason || (product === 'hosting'
        ? (isFirstActivation ? 'hosting_create' : 'hosting_cycle')
        : (isFirstActivation ? 'subscription_create' : planChanged ? 'subscription_downgrade' : 'subscription_cycle'));

    if (replacedLocally) {
        // Money was collected on a subscription we already replaced/ended — record it, don't revive it
        console.warn(`[billing] Charge ${payment?.id} on locally cancelled subscription ${rzpSub.id} — recorded, not reactivated`);
    } else {
        // Period and plan only move forward: an older charge arriving late never
        // rewinds the period or undoes a plan change applied by a newer one.
        const pendingClear = product === 'search'
            ? `, pending_plan_change_at = IF(pending_plan_id = ?, NULL, pending_plan_change_at),
                 pending_plan_id = IF(pending_plan_id = ?, NULL, pending_plan_id)`
            : '';
        const params: any[] = [
            eventAt,                         // status guard
            periodEnd, plan.id,              // plan
            periodEnd, periodStart,          // period start
            periodEnd, periodEnd,            // period end
            eventAt, rzpSub.status || 'active', // gateway status
            eventAt,
        ];
        if (product === 'search') params.push(plan.id, plan.id);
        params.push(row.id);

        await query(
            `UPDATE ${cfg.subTable} SET
                status = CASE WHEN status IN ('incomplete','trialing') OR gateway_event_at IS NULL OR ? >= gateway_event_at THEN 'active' ELSE status END,
                ${cfg.planFk} = CASE WHEN current_period_end IS NULL OR ? > current_period_end THEN ? ELSE ${cfg.planFk} END,
                current_period_start = CASE WHEN current_period_end IS NULL OR ? > current_period_end THEN ? ELSE current_period_start END,
                current_period_end = CASE WHEN current_period_end IS NULL OR ? > current_period_end THEN ? ELSE current_period_end END,
                gateway_status = CASE WHEN gateway_event_at IS NULL OR ? >= gateway_event_at THEN ? ELSE gateway_status END,
                gateway_event_at = GREATEST(COALESCE(gateway_event_at, 0), ?)
                ${pendingClear}
             WHERE id = ?`,
            params
        );

        if (isFirstActivation) await cancelOtherSubscriptions(product, tenantId, row.id, rzpSub.id);
        if (product === 'search') {
            await query("UPDATE tenants SET status = 'active', plan_id = ? WHERE id = ?", [plan.id, tenantId]);
        }
        await invalidateTenantCaches(tenantId);
    }

    const creditApplied = billingReason === 'subscription_upgrade' && amount < Number(plan.price);
    const invoice = await issueInvoice({
        tenantId,
        planName: cfg.invoicePlanName(plan),
        lineDescription: creditApplied
            ? `${cfg.lineDescription(plan)} (one-time plan-change credit applied)`
            : cfg.lineDescription(plan),
        amount,
        currency,
        billingReason,
        periodStart,
        periodEnd,
        gatewayPaymentId: payment.id,
    });

    await recordOrder({
        tenantId,
        planId: plan.id,
        planName: cfg.invoicePlanName(plan),
        razorpaySubscriptionId: rzpSub.id,
        razorpayPaymentId: payment.id,
        amount,
        currency,
        status: 'captured',
        method: payment.method || null,
        email: payment.email || null,
        contact: payment.contact || null,
        notes: o.notes || (isFirstActivation ? 'Initial subscription payment' : 'Recurring subscription charge'),
        product,
    });

    if (invoice.created && isFirstActivation && !replacedLocally && product === 'search') {
        const tenants: any = await query('SELECT store_name, email FROM tenants WHERE id = ?', [tenantId]);
        if (tenants?.[0]) {
            sendSubscriptionWelcomeEmail(tenants[0].email, tenants[0].store_name, plan.name, parseFloat(plan.price), periodEnd)
                .catch((e) => console.error('Welcome email error:', e));
        }
    }

    return { duplicate: !invoice.created, invoiceNumber: invoice.invoiceNumber, plan, periodStart, periodEnd, amount, currency };
}

// ─── Mandate authorised (subscription.authenticated / checkout verify) ────────
// trial   → nothing is charged; subscription waits for starts_at (= trial end)
// upgrade → the upfront addon (discounted first cycle) was collected now
// immediate → the first charge arrives separately (verify / subscription.charged)
export async function handleAuthenticated(o: { product: Product; rzpSub: any; payment?: any; eventAt: number }): Promise<{
    checkoutType: CheckoutType; charge?: Awaited<ReturnType<typeof recordCharge>>; startsAt?: Date | null;
}> {
    const { product, rzpSub, payment, eventAt } = o;
    const cfg = PRODUCTS[product];
    const row = await findSubscriptionByGatewayId(product, rzpSub.id);
    const checkoutType = ((row?.checkout_type || rzpSub.notes?.checkout_type || 'immediate') as CheckoutType);
    if (!row) return { checkoutType };

    if (checkoutType === 'upgrade' && payment) {
        const start = unixToDate(payment.created_at) || new Date();
        const end = unixToDate(rzpSub.start_at) || (row.starts_at ? new Date(row.starts_at) : addBillingPeriod(start, 'monthly'));
        const charge = await recordCharge({
            product, rzpSub, payment, eventAt,
            period: { start, end },
            billingReason: product === 'search' ? 'subscription_upgrade' : undefined,
            notes: 'Plan change — first cycle paid upfront',
        });
        return { checkoutType, charge };
    }

    if (checkoutType === 'trial') {
        const promoted: any = await query(
            `UPDATE ${cfg.subTable} SET status = 'trialing', gateway_status = ?, gateway_event_at = ?
             WHERE id = ? AND status = 'incomplete'`,
            [rzpSub.status || 'authenticated', eventAt, row.id]
        );
        if (promoted.affectedRows > 0) {
            // A trial user who picked a different plan replaces the earlier choice
            await cancelOtherSubscriptions(product, Number(row.tenant_id), row.id, rzpSub.id);
            await invalidateTenantCaches(Number(row.tenant_id));
        }
        if (payment?.id) {
            await recordOrder({
                tenantId: Number(row.tenant_id),
                planId: Number(row[cfg.planFk]),
                razorpaySubscriptionId: rzpSub.id,
                razorpayPaymentId: payment.id,
                amount: Number(payment.amount || 0) / 100,
                currency: String(payment.currency || 'INR').toUpperCase(),
                status: payment.status === 'refunded' ? 'refunded' : 'authorized',
                method: payment.method || null,
                email: payment.email || null,
                contact: payment.contact || null,
                notes: 'Card verified for trial — token amount refunded, not a charge',
                product,
            });
        }
        return { checkoutType, startsAt: row.starts_at ? new Date(row.starts_at) : unixToDate(rzpSub.start_at) };
    }

    await query(
        `UPDATE ${cfg.subTable} SET gateway_status = ?, gateway_event_at = ?
         WHERE id = ? AND (gateway_event_at IS NULL OR gateway_event_at <= ?)`,
        [rzpSub.status || 'authenticated', eventAt, row.id, eventAt]
    );
    return { checkoutType };
}

// ─── Other gateway state changes ──────────────────────────────────────────────
export async function applyGatewayState(o: { product: Product; rzpSub: any; eventAt: number; event: string }): Promise<string> {
    const { product, rzpSub, eventAt } = o;
    const cfg = PRODUCTS[product];
    const row = await findSubscriptionByGatewayId(product, rzpSub.id);
    if (!row) return 'unknown_subscription';
    if (row.gateway_event_at && eventAt < Number(row.gateway_event_at)) return 'stale_event';
    if (TERMINAL_GATEWAY_STATUSES.has(row.gateway_status)) return 'already_terminal';

    const tenantId = Number(row.tenant_id);
    const gatewayStatus: string = rzpSub.status || '';
    let setLocal = '';
    let afterAccessLoss = false;
    let sendPausedEmail = false;

    switch (gatewayStatus) {
        case 'active': // activated / resumed / updated
            if (row.status === 'past_due') {
                setLocal = ", status = 'active'";
                if (product === 'search') {
                    await query("UPDATE tenants SET status = 'active', plan_id = ? WHERE id = ? AND status = 'suspended'", [row.plan_id, tenantId]);
                }
            }
            break;
        case 'halted':
        case 'paused':
            if (row.status === 'active' || row.status === 'trialing') {
                setLocal = ", status = 'past_due'";
                afterAccessLoss = true;
                sendPausedEmail = gatewayStatus === 'halted';
            }
            break;
        case 'cancelled':
        case 'completed':
        case 'expired': {
            const paidUntil = row.current_period_end ? new Date(row.current_period_end) : null;
            if (row.status === 'active' && paidUntil && paidUntil.getTime() > Date.now()) {
                // Already paid for this period — access continues until it ends
                setLocal = ', cancel_at_period_end = 1, cancelled_at = COALESCE(cancelled_at, NOW())';
            } else if (row.status !== 'cancelled') {
                setLocal = ", status = 'cancelled', cancel_at_period_end = 0, cancelled_at = COALESCE(cancelled_at, NOW())";
                afterAccessLoss = true;
            }
            break;
        }
        default: // created, authenticated, pending — informational only; access unchanged
            break;
    }

    const result: any = await query(
        `UPDATE ${cfg.subTable} SET gateway_status = ?, gateway_event_at = ?${setLocal}
         WHERE id = ? AND (gateway_event_at IS NULL OR gateway_event_at <= ?)`,
        [gatewayStatus, eventAt, row.id, eventAt]
    );
    if (result.affectedRows === 0) return 'stale_event';

    if (afterAccessLoss) {
        const suspended = await suspendTenantIfNoAccess(product, tenantId);
        if (sendPausedEmail && (suspended || product === 'hosting')) {
            const t: any = await query('SELECT email, store_name FROM tenants WHERE id = ?', [tenantId]);
            if (t?.[0]) {
                sendSubscriptionPausedEmail(t[0].email, t[0].store_name, cfg.serviceName)
                    .catch((e) => console.error('Paused email error:', e));
            }
        }
    }
    await invalidateTenantCaches(tenantId);
    return `applied:${gatewayStatus}`;
}

// ─── Failed payment ───────────────────────────────────────────────────────────
async function handlePaymentFailed(payment: any): Promise<string> {
    let tenantId = parseInt(payment?.notes?.tenant_id || '0');
    let product: Product = payment?.notes?.product === 'hosting' ? 'hosting' : 'search';
    let rzpSubId: string | null = null;

    // Recurring payments don't always carry our notes — resolve via the invoice's subscription
    if (!tenantId && payment?.invoice_id) {
        try {
            const { client } = await getRazorpayClient();
            const invoice: any = await client.invoices.fetch(payment.invoice_id);
            rzpSubId = invoice?.subscription_id || null;
        } catch (e: any) {
            console.warn('payment.failed: invoice lookup failed:', e?.error?.description || e?.message);
        }
    }
    if (!tenantId && rzpSubId) {
        for (const p of ['search', 'hosting'] as Product[]) {
            const row = await findSubscriptionByGatewayId(p, rzpSubId);
            if (row) { tenantId = Number(row.tenant_id); product = p; break; }
        }
    }
    if (!tenantId) return 'unresolved_tenant';

    await recordOrder({
        tenantId,
        razorpaySubscriptionId: rzpSubId,
        razorpayPaymentId: payment.id,
        razorpayOrderId: payment.order_id || null,
        amount: Number(payment.amount || 0) / 100,
        currency: String(payment.currency || 'INR').toUpperCase(),
        status: 'failed',
        method: payment.method || null,
        email: payment.email || null,
        contact: payment.contact || null,
        notes: payment.error_description || 'Payment failed',
        product,
    });

    // Dunning: notify the customer so they can fix payment before service pauses
    const t: any = await query('SELECT email, store_name FROM tenants WHERE id = ?', [tenantId]);
    if (t?.[0]) {
        sendPaymentFailedEmail(t[0].email, t[0].store_name, PRODUCTS[product].serviceName, payment.error_description || undefined)
            .catch((e) => console.error('Payment-failed email error:', e));
    }
    return 'recorded';
}

// ─── Webhook dispatcher ───────────────────────────────────────────────────────
export async function processWebhookEvent(event: any): Promise<string> {
    const eventAt = Number(event?.created_at) || Math.floor(Date.now() / 1000);
    const rzpSub = event?.payload?.subscription?.entity;
    const payment = event?.payload?.payment?.entity;

    switch (event?.event) {
        case 'subscription.authenticated': {
            if (!rzpSub) return 'no_subscription';
            const product = await resolveProduct(rzpSub);
            const r = await handleAuthenticated({ product, rzpSub, payment, eventAt });
            return `authenticated:${r.checkoutType}`;
        }
        case 'subscription.charged': {
            if (!rzpSub || !payment?.id) return 'no_payment';
            const product = await resolveProduct(rzpSub);
            const r = await recordCharge({ product, rzpSub, payment, eventAt });
            return r.duplicate ? 'charge_duplicate' : 'charge_recorded';
        }
        case 'subscription.activated':
        case 'subscription.pending':
        case 'subscription.halted':
        case 'subscription.cancelled':
        case 'subscription.completed':
        case 'subscription.paused':
        case 'subscription.resumed':
        case 'subscription.updated':
        case 'subscription.expired': {
            if (!rzpSub) return 'no_subscription';
            const product = await resolveProduct(rzpSub);
            return applyGatewayState({ product, rzpSub, eventAt, event: event.event });
        }
        case 'payment.failed':
            return payment ? handlePaymentFailed(payment) : 'no_payment';
        default:
            return 'ignored';
    }
}

// ─── Checkout verification (browser handler → server) ─────────────────────────
// Never trusts the plan the browser sends: the signature proves Razorpay issued
// this payment for this subscription, the local checkout row proves it belongs
// to this tenant, and the Razorpay subscription's plan_id decides the plan.
export async function verifyCheckout(o: {
    product: Product;
    tenantId: number;
    paymentId: string;
    subscriptionId: string;
    signature: string;
}): Promise<{
    checkoutType: CheckoutType; plan: any; invoiceNumber?: string; periodEnd?: Date; amount?: number; startsAt?: Date | null; duplicate?: boolean;
}> {
    const { product, tenantId, paymentId, subscriptionId, signature } = o;
    const cfg = PRODUCTS[product];
    await ensureTables(product);
    const config = await getRazorpayConfig();

    if (!verifySubscriptionSignature(paymentId, subscriptionId, signature, config.key_secret)) {
        await recordOrder({
            tenantId, razorpaySubscriptionId: subscriptionId, razorpayPaymentId: paymentId,
            amount: 0, currency: config.currency, status: 'failed', notes: 'Signature verification failed', product,
        });
        throw new BillingError(400, 'Payment verification failed');
    }

    const row = await findSubscriptionByGatewayId(product, subscriptionId);
    if (!row || Number(row.tenant_id) !== Number(tenantId)) {
        throw new BillingError(404, 'This payment does not belong to a checkout on your account');
    }

    const { client } = await getRazorpayClient();
    const rzpSub: any = await client.subscriptions.fetch(subscriptionId);
    const notedProduct = rzpSub?.notes?.product || 'search';
    if (String(rzpSub?.notes?.tenant_id) !== String(tenantId) || notedProduct !== product) {
        console.error(`[billing] verify mismatch: subscription ${subscriptionId} notes`, rzpSub?.notes, 'tenant', tenantId, 'product', product);
        throw new BillingError(403, 'This payment does not belong to your account');
    }

    const plan = await findLocalPlanByRazorpayPlanId(config.mode, cfg.planTable, rzpSub.plan_id);
    if (!plan) {
        console.error(`[billing] verify: Razorpay plan ${rzpSub.plan_id} is not mapped in ${config.mode} mode`);
        throw new BillingError(409, 'The purchased plan is not recognised. Please contact support.');
    }
    if (Number(plan.id) !== Number(row[cfg.planFk])) {
        console.error(`[billing] verify: subscription ${subscriptionId} is on ${cfg.planTable} #${plan.id}, checkout row says #${row[cfg.planFk]}`);
        throw new BillingError(409, 'The purchased plan does not match this checkout. Please contact support.');
    }

    // A trial checkout only verifies the card: Razorpay charges a token amount and
    // refunds it straight away, so by now that payment is usually 'refunded'.
    // Real charges (immediate / upgrade) must be authorized or captured.
    const payment: any = await client.payments.fetch(paymentId);
    const acceptedStatuses = row.checkout_type === 'trial' ? ['authorized', 'captured', 'refunded'] : ['authorized', 'captured'];
    if (!payment || !acceptedStatuses.includes(payment.status)) {
        throw new BillingError(402, 'Payment was not completed');
    }

    // Webhooks carry Razorpay's event timestamps and decide state ordering; the
    // verify snapshot is applied with eventAt 0 so it only fills state no webhook
    // has set yet and any later webhook still takes precedence.
    const VERIFY_EVENT_AT = 0;
    const checkoutType = (row.checkout_type || 'immediate') as CheckoutType;

    if (checkoutType === 'trial' || checkoutType === 'upgrade') {
        const r = await handleAuthenticated({ product, rzpSub, payment, eventAt: VERIFY_EVENT_AT });
        return {
            checkoutType,
            plan,
            startsAt: r.startsAt ?? (row.starts_at ? new Date(row.starts_at) : null),
            invoiceNumber: r.charge?.invoiceNumber,
            periodEnd: r.charge?.periodEnd,
            amount: r.charge?.amount,
            duplicate: r.charge?.duplicate,
        };
    }

    const charge = await recordCharge({ product, rzpSub, payment, eventAt: VERIFY_EVENT_AT });
    return {
        checkoutType, plan,
        invoiceNumber: charge.invoiceNumber, periodEnd: charge.periodEnd, amount: charge.amount, duplicate: charge.duplicate,
    };
}

// ─── Cancellation ─────────────────────────────────────────────────────────────
// Paid subscriptions: cancel at Razorpay at cycle end, keep access until
// current_period_end. Trial subscriptions (nothing charged yet): cancel now.
export async function requestCancel(product: Product, tenantId: number): Promise<{ message: string; accessUntil: Date | null }> {
    const cfg = PRODUCTS[product];
    await ensureTables(product);
    const subs: any = await query(
        `SELECT * FROM ${cfg.subTable}
         WHERE tenant_id = ? AND status IN ('active','trialing')
         ORDER BY status = 'active' DESC, current_period_end DESC, id DESC LIMIT 1`,
        [tenantId]
    );
    const sub = subs?.[0];
    if (!sub) throw new BillingError(404, 'No active subscription found');
    if (sub.cancel_at_period_end) {
        throw new BillingError(400, `Your subscription is already cancelled and ends on ${new Date(sub.current_period_end).toLocaleDateString()}`);
    }

    const cancelAtGateway = async (atCycleEnd: boolean) => {
        if (!sub.razorpay_subscription_id) return;
        try {
            const { client } = await getRazorpayClient();
            await client.subscriptions.cancel(sub.razorpay_subscription_id, atCycleEnd);
        } catch (e: any) {
            const detail = e?.error?.description || e?.message || '';
            console.error('Razorpay cancel error:', detail);
            throw new BillingError(502, 'Could not cancel the subscription with the payment gateway. Please try again.');
        }
    };

    if (sub.status === 'trialing') {
        await cancelAtGateway(false);
        await query(`UPDATE ${cfg.subTable} SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?`, [sub.id]);
        await invalidateTenantCaches(tenantId);
        const t: any = await query('SELECT trial_ends_at FROM tenants WHERE id = ?', [tenantId]);
        const trialEnd = t?.[0]?.trial_ends_at ? new Date(t[0].trial_ends_at) : null;
        return {
            message: `Your scheduled subscription has been cancelled and you will not be charged.${trialEnd && trialEnd > new Date() ? ` Your free trial continues until ${trialEnd.toLocaleDateString()}.` : ''}`,
            accessUntil: trialEnd,
        };
    }

    // A prepaid plan-change subscription has no active Razorpay cycle yet
    // (authenticated until its first recurring charge) — Razorpay only allows an
    // immediate cancel there. The prepaid period stays usable either way.
    const noActiveGatewayCycle = ['created', 'authenticated'].includes(sub.gateway_status);
    await cancelAtGateway(!noActiveGatewayCycle);

    const clearPending = product === 'search' ? ', pending_plan_id = NULL, pending_plan_change_at = NULL' : '';
    await query(
        `UPDATE ${cfg.subTable} SET cancel_at_period_end = 1, cancelled_at = NOW()${clearPending} WHERE id = ?`,
        [sub.id]
    );
    await invalidateTenantCaches(tenantId);
    const accessUntil = sub.current_period_end ? new Date(sub.current_period_end) : null;
    return {
        message: `Subscription cancelled. You keep access until ${accessUntil ? accessUntil.toLocaleDateString() : 'the end of the billing period'}.`,
        accessUntil,
    };
}

// ─── End subscriptions whose cancelled period is over ─────────────────────────
export async function expireEndedSubscriptions(tenantId?: number): Promise<number> {
    let expired = 0;
    for (const product of ['search', 'hosting'] as Product[]) {
        const cfg = PRODUCTS[product];
        await ensureTables(product);
        const rows: any = await query(
            `SELECT id, tenant_id FROM ${cfg.subTable}
             WHERE status = 'active' AND cancel_at_period_end = 1 AND current_period_end <= NOW()
             ${tenantId ? 'AND tenant_id = ?' : ''}`,
            tenantId ? [tenantId] : []
        );
        for (const r of rows) {
            await query(`UPDATE ${cfg.subTable} SET status = 'cancelled' WHERE id = ? AND status = 'active'`, [r.id]);
            await suspendTenantIfNoAccess(product, Number(r.tenant_id));
            await invalidateTenantCaches(Number(r.tenant_id));
            expired++;
        }
    }
    return expired;
}

// ─── Trial checkout eligibility ───────────────────────────────────────────────
// Razorpay needs start_at in the future; too close to the end the trial is
// treated as over and the customer is charged right away.
const MIN_TRIAL_REMAINING_MS = 60 * 60 * 1000;

export function remainingTrialEnd(tenant: { status: string; trial_ends_at: any }): Date | null {
    if (tenant.status !== 'trial' || !tenant.trial_ends_at) return null;
    const end = new Date(tenant.trial_ends_at);
    return end.getTime() - Date.now() > MIN_TRIAL_REMAINING_MS ? end : null;
}
