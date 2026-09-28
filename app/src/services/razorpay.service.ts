import Razorpay from 'razorpay';
import crypto from 'crypto';
import { query } from '../config/database';
import { getRazorpayConfig, RazorpayConfig } from './payment-settings.service';
import { backfillYearlyVariants } from './plan-sync.service';

export type PlanTable = 'plans' | 'hosting_plans';
export type GatewayMode = 'test' | 'live';

// ─── Razorpay client (credentials come from env or admin-configured DB settings) ─
export async function getRazorpayClient(): Promise<{ client: Razorpay; config: RazorpayConfig }> {
    const config = await getRazorpayConfig();
    if (!config.key_id || !config.key_secret) {
        throw new Error('Razorpay is not configured. Set API keys in Admin → Payment Settings.');
    }
    const client = new Razorpay({ key_id: config.key_id, key_secret: config.key_secret });
    return { client, config };
}

// ─── Lazy migrations ──────────────────────────────────────────────────────────
// Gateway lifecycle columns shared by `subscriptions` and `hosting_subscriptions`.
// `status` is Cataseek's access state; `gateway_status` mirrors Razorpay's own
// subscription status, and `gateway_event_at` (unix seconds) is the timestamp of
// the newest gateway state applied — older, out-of-order webhooks are ignored.
export async function ensureSubscriptionLifecycleColumns(table: 'subscriptions' | 'hosting_subscriptions') {
    const defaultClause = table === 'subscriptions' ? "DEFAULT 'active'" : "NOT NULL DEFAULT 'active'";
    try {
        await query(`ALTER TABLE ${table} MODIFY COLUMN status ENUM('active','trialing','past_due','cancelled','incomplete') ${defaultClause}`);
    } catch (e) { console.error(`${table}.status enum migration error:`, e); }

    const alters = [
        `ALTER TABLE ${table} ADD COLUMN gateway_status VARCHAR(20) NULL`,
        `ALTER TABLE ${table} ADD COLUMN gateway_event_at BIGINT NULL`,
        `ALTER TABLE ${table} ADD COLUMN checkout_type VARCHAR(20) NULL`,
        // First recurring charge date for delayed-start subscriptions (trial end / next cycle)
        `ALTER TABLE ${table} ADD COLUMN starts_at DATETIME NULL`,
        // Cancel requested: access continues until current_period_end, then ends
        `ALTER TABLE ${table} ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE`,
    ];
    for (const sql of alters) {
        try { await query(sql); } catch (_) { /* exists */ }
    }
}

// Memoised: concurrent first callers share one run (backfillYearlyVariants must not race)
let migration: Promise<void> | null = null;
export function ensurePaymentTables(): Promise<void> {
    if (!migration) {
        migration = runPaymentMigrations().catch((e) => { migration = null; throw e; });
    }
    return migration;
}

async function runPaymentMigrations() {

    await query(`
        CREATE TABLE IF NOT EXISTS orders (
            id                       INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id                INT NOT NULL,
            plan_id                  INT,
            plan_name                VARCHAR(100),
            razorpay_subscription_id VARCHAR(64),
            razorpay_payment_id      VARCHAR(64),
            razorpay_order_id        VARCHAR(64),
            amount                   DECIMAL(10,2) NOT NULL DEFAULT 0,
            currency                 VARCHAR(10) NOT NULL DEFAULT 'INR',
            status                   ENUM('created','authorized','captured','failed','refunded') NOT NULL DEFAULT 'created',
            method                   VARCHAR(30),
            email                    VARCHAR(255),
            contact                  VARCHAR(30),
            notes                    TEXT,
            created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            INDEX idx_tenant (tenant_id),
            INDEX idx_status (status),
            INDEX idx_rzp_payment (razorpay_payment_id),
            INDEX idx_rzp_subscription (razorpay_subscription_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try { await query("ALTER TABLE orders ADD COLUMN product VARCHAR(20) NOT NULL DEFAULT 'search'"); } catch (_) { /* exists */ }
    // One order row per gateway payment, even when /verify and the webhook race
    try { await query('ALTER TABLE orders ADD UNIQUE INDEX uq_rzp_payment (razorpay_payment_id)'); } catch (_) { /* exists or legacy duplicates */ }

    // Cataseek plan → Razorpay plan, per gateway mode. Razorpay plans are created
    // by hand in the Razorpay Dashboard (test and live keep separate plans) and
    // mapped here; checkout never creates plans on its own.
    await query(`
        CREATE TABLE IF NOT EXISTS razorpay_plan_mappings (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            mode             ENUM('test','live') NOT NULL,
            plan_table       ENUM('plans','hosting_plans') NOT NULL,
            local_plan_id    INT NOT NULL,
            razorpay_plan_id VARCHAR(64) NOT NULL,
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_local (mode, plan_table, local_plan_id),
            UNIQUE KEY uq_rzp (mode, razorpay_plan_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Webhook deliveries by x-razorpay-event-id (Razorpay delivers at-least-once)
    await query(`
        CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
            event_id     VARCHAR(64) PRIMARY KEY,
            event        VARCHAR(64) NOT NULL,
            entity_id    VARCHAR(64) NULL,
            status       ENUM('processing','processed','failed') NOT NULL DEFAULT 'processing',
            attempts     INT NOT NULL DEFAULT 1,
            last_error   TEXT NULL,
            received_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            processed_at DATETIME NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // subscriptions: track the Razorpay subscription id + gateway lifecycle
    try { await query("ALTER TABLE subscriptions ADD COLUMN razorpay_subscription_id VARCHAR(64) NULL"); } catch (_) { /* exists */ }
    try { await query("ALTER TABLE subscriptions ADD INDEX idx_rzp_sub (razorpay_subscription_id)"); } catch (_) { /* exists */ }
    await ensureSubscriptionLifecycleColumns('subscriptions');

    // Deferred downgrades: the lower plan is recorded here and only swapped in
    // at current_period_end — see getPlanChangeCredit / applyDuePlanChange in billing.routes.
    try { await query("ALTER TABLE subscriptions ADD COLUMN pending_plan_id INT NULL"); } catch (_) { /* exists */ }
    try { await query("ALTER TABLE subscriptions ADD COLUMN pending_plan_change_at DATETIME NULL"); } catch (_) { /* exists */ }

    // invoices: one invoice per gateway payment — the unique key makes charge
    // processing idempotent across /verify, webhook retries and duplicates.
    await ensureInvoicesTable();
    try { await query('ALTER TABLE invoices ADD COLUMN gateway_payment_id VARCHAR(64) NULL'); } catch (_) { /* exists */ }
    try { await query('ALTER TABLE invoices ADD UNIQUE INDEX uq_gateway_payment (gateway_payment_id)'); } catch (_) { /* exists */ }

    // Yearly billing: monthly rows are the source of truth, yearly siblings
    // (linked via parent_plan_id) are auto-generated — see plan-sync.service.
    try { await query("ALTER TABLE plans ADD COLUMN yearly_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0"); } catch (_) { /* exists */ }
    try { await query("ALTER TABLE plans ADD COLUMN parent_plan_id INT NULL"); } catch (_) { /* exists */ }
    await backfillYearlyVariants('plans');

    await dropUnusedStripeColumns();
}

export async function ensureInvoicesTable() {
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

// Stripe was never wired to the dashboard; drop its columns only while they are empty.
async function dropUnusedStripeColumns() {
    const targets: Array<[string, string]> = [
        ['subscriptions', 'stripe_subscription_id'],
        ['plans', 'stripe_price_id'],
        ['tenants', 'stripe_customer_id'],
    ];
    for (const [table, column] of targets) {
        try {
            const cols: any = await query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
            if (!cols || cols.length === 0) continue;
            const used: any = await query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IS NOT NULL`);
            if (Number(used?.[0]?.n) > 0) {
                console.warn(`[migration] ${table}.${column} has data — left in place`);
                continue;
            }
            await query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
            console.log(`[migration] dropped unused ${table}.${column}`);
        } catch (e) {
            console.error(`[migration] could not drop ${table}.${column}:`, e);
        }
    }
}

// ─── Plan mapping ─────────────────────────────────────────────────────────────
export class PlanMappingError extends Error {}

export const RAZORPAY_PLAN_ID_PATTERN = /^plan_[A-Za-z0-9]{14}$/;

export async function getMappedRazorpayPlanId(mode: GatewayMode, table: PlanTable, localPlanId: number): Promise<string | null> {
    await ensurePaymentTables();
    const rows: any = await query(
        'SELECT razorpay_plan_id FROM razorpay_plan_mappings WHERE mode = ? AND plan_table = ? AND local_plan_id = ?',
        [mode, table, localPlanId]
    );
    return rows?.[0]?.razorpay_plan_id || null;
}

export async function setPlanMapping(mode: GatewayMode, table: PlanTable, localPlanId: number, razorpayPlanId: string | null) {
    await ensurePaymentTables();
    if (!razorpayPlanId) {
        await query('DELETE FROM razorpay_plan_mappings WHERE mode = ? AND plan_table = ? AND local_plan_id = ?', [mode, table, localPlanId]);
        return;
    }
    if (!RAZORPAY_PLAN_ID_PATTERN.test(razorpayPlanId)) {
        throw new PlanMappingError(`"${razorpayPlanId}" is not a valid Razorpay plan id (expected plan_ + 14 characters)`);
    }
    await query(
        `INSERT INTO razorpay_plan_mappings (mode, plan_table, local_plan_id, razorpay_plan_id) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE razorpay_plan_id = VALUES(razorpay_plan_id), updated_at = NOW()`,
        [mode, table, localPlanId, razorpayPlanId]
    );
    validatedPlans.clear();
}

// Reverse lookup used by verify + webhooks: the Razorpay subscription's plan_id
// is the source of truth for which Cataseek plan was actually bought.
export async function findLocalPlanByRazorpayPlanId(mode: GatewayMode, table: PlanTable, razorpayPlanId: string): Promise<any | null> {
    await ensurePaymentTables();
    if (!razorpayPlanId) return null;
    const rows: any = await query(
        `SELECT p.* FROM razorpay_plan_mappings m
         JOIN ${table} p ON p.id = m.local_plan_id
         WHERE m.mode = ? AND m.plan_table = ? AND m.razorpay_plan_id = ?`,
        [mode, table, razorpayPlanId]
    );
    return rows?.[0] || null;
}

// Compares a Razorpay plan entity with the Cataseek plan it is mapped to.
export function comparePlan(rzpPlan: any, localPlan: any, currency: string): string[] {
    const problems: string[] = [];
    const expectedAmount = Math.round(Number(localPlan.price) * 100);
    const expectedPeriod = localPlan.billing_period === 'yearly' ? 'yearly' : 'monthly';
    if (Number(rzpPlan?.item?.amount) !== expectedAmount) {
        problems.push(`amount ${rzpPlan?.item?.amount} ≠ expected ${expectedAmount} (${localPlan.price} ${currency})`);
    }
    if (String(rzpPlan?.item?.currency || '').toUpperCase() !== currency.toUpperCase()) {
        problems.push(`currency ${rzpPlan?.item?.currency} ≠ expected ${currency}`);
    }
    if (rzpPlan?.period !== expectedPeriod) problems.push(`period ${rzpPlan?.period} ≠ expected ${expectedPeriod}`);
    if (Number(rzpPlan?.interval) !== 1) problems.push(`interval ${rzpPlan?.interval} ≠ expected 1`);
    return problems;
}

// Validated mappings are cached briefly so checkout doesn't fetch the plan every time
const validatedPlans = new Map<string, number>();
const PLAN_VALIDATION_TTL_MS = 10 * 60 * 1000;

// Returns the Razorpay plan id to subscribe to, after checking the Razorpay plan
// still charges exactly the Cataseek price. Never creates plans.
export async function resolveRazorpayPlanForCheckout(plan: any, table: PlanTable = 'plans'): Promise<string> {
    const { client, config } = await getRazorpayClient();
    const rzpPlanId = await getMappedRazorpayPlanId(config.mode, table, plan.id);
    if (!rzpPlanId) {
        throw new PlanMappingError(`No Razorpay ${config.mode} plan is mapped to ${table} #${plan.id} (${plan.name} ${plan.billing_period})`);
    }

    const cacheKey = `${config.mode}|${table}|${plan.id}|${rzpPlanId}|${plan.price}|${plan.billing_period}|${config.currency}`;
    const validUntil = validatedPlans.get(cacheKey);
    if (validUntil && validUntil > Date.now()) return rzpPlanId;

    let rzpPlan: any;
    try {
        rzpPlan = await client.plans.fetch(rzpPlanId);
    } catch (e: any) {
        throw new PlanMappingError(`Razorpay plan ${rzpPlanId} could not be fetched: ${e?.error?.description || e?.message}`);
    }
    const problems = comparePlan(rzpPlan, plan, config.currency);
    if (problems.length > 0) {
        throw new PlanMappingError(`Razorpay plan ${rzpPlanId} does not match ${table} #${plan.id}: ${problems.join('; ')}`);
    }
    validatedPlans.set(cacheKey, Date.now() + PLAN_VALIDATION_TTL_MS);
    return rzpPlanId;
}

// Explicit admin action (never called from checkout): create a Razorpay plan for
// an unmapped Cataseek plan in the current mode and map it.
export async function createAndMapRazorpayPlan(plan: any, table: PlanTable): Promise<string> {
    const { client, config } = await getRazorpayClient();
    const existing = await getMappedRazorpayPlanId(config.mode, table, plan.id);
    if (existing) throw new PlanMappingError(`${table} #${plan.id} is already mapped to ${existing} in ${config.mode} mode`);

    const namePrefix = table === 'hosting_plans' ? 'Hosting — ' : '';
    const rzpPlan: any = await client.plans.create({
        period: plan.billing_period === 'yearly' ? 'yearly' : 'monthly',
        interval: 1,
        item: {
            name: `${namePrefix}${plan.name} Plan (${plan.billing_period})`,
            description: (plan.description || '').slice(0, 250) || undefined,
            amount: Math.round(Number(plan.price) * 100), // smallest currency unit
            currency: config.currency,
        },
        notes: { local_plan_id: String(plan.id), local_table: table },
    });
    await setPlanMapping(config.mode, table, plan.id, rzpPlan.id);
    return rzpPlan.id;
}

// ─── Subscription creation ────────────────────────────────────────────────────
// startAt delays the first recurring charge: used for the free trial (first
// charge when the trial ends) and for plan changes with a one-time credit (the
// discounted first cycle is collected now as an `upfront` addon on the
// authorisation transaction, recurring billing starts next cycle).
export async function createRazorpaySubscription(
    tenant: any,
    plan: any,
    opts: {
        table?: PlanTable;
        product?: 'search' | 'hosting';
        checkoutType?: 'immediate' | 'trial' | 'upgrade';
        startAt?: number; // unix seconds — recurring charges begin here
        upfront?: { amount: number; label: string }; // collected at checkout
    } = {}
): Promise<any> {
    const { client, config } = await getRazorpayClient();
    const rzpPlanId = await resolveRazorpayPlanForCheckout(plan, opts.table || 'plans');

    const totalCount = plan.billing_period === 'yearly' ? 10 : 120; // max renewals (10 years)
    const payload: any = {
        plan_id: rzpPlanId,
        customer_notify: 1,
        total_count: totalCount,
        notes: {
            tenant_id: String(tenant.id),
            plan_id: String(plan.id),
            store_name: tenant.store_name || '',
            product: opts.product || 'search',
            checkout_type: opts.checkoutType || 'immediate',
        },
    };

    if (opts.startAt) payload.start_at = opts.startAt;
    if (opts.upfront && opts.upfront.amount > 0) {
        payload.addons = [{
            item: {
                name: opts.upfront.label.slice(0, 250),
                amount: Math.round(opts.upfront.amount * 100),
                currency: config.currency,
            },
        }];
    }

    const subscription: any = await client.subscriptions.create(payload);
    return subscription;
}

// ─── Signature verification ───────────────────────────────────────────────────
function safeEqualHex(expected: string, actual: string): boolean {
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(actual)));
    } catch {
        return false;
    }
}

// Checkout handler signature: HMAC_SHA256(payment_id + '|' + subscription_id, key_secret)
export function verifySubscriptionSignature(paymentId: string, subscriptionId: string, signature: string, keySecret: string): boolean {
    if (!keySecret) return false;
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${paymentId}|${subscriptionId}`)
        .digest('hex');
    return safeEqualHex(expected, signature);
}

// Webhook signature: HMAC_SHA256(raw_body, webhook_secret)
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string, webhookSecret: string): boolean {
    if (!webhookSecret) return false;
    const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
    return safeEqualHex(expected, signature);
}

// ─── Order recording ──────────────────────────────────────────────────────────
export async function recordOrder(o: {
    tenantId: number;
    planId?: number | null;
    planName?: string | null;
    razorpaySubscriptionId?: string | null;
    razorpayPaymentId?: string | null;
    razorpayOrderId?: string | null;
    amount: number;
    currency: string;
    status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
    method?: string | null;
    email?: string | null;
    contact?: string | null;
    notes?: string | null;
    product?: 'search' | 'hosting';
}): Promise<number> {
    await ensurePaymentTables();

    const values = [
        o.tenantId, o.planId || null, o.planName || null,
        o.razorpaySubscriptionId || null, o.razorpayPaymentId || null, o.razorpayOrderId || null,
        o.amount, o.currency, o.status, o.method || null, o.email || null, o.contact || null, o.notes || null,
        o.product || 'search',
    ];

    // Upsert by payment id (unique) so webhook + verify don't duplicate the same payment.
    // A captured payment is never downgraded back to created/authorized by a late event.
    const result: any = await query(
        `INSERT INTO orders (tenant_id, plan_id, plan_name, razorpay_subscription_id, razorpay_payment_id, razorpay_order_id,
                             amount, currency, status, method, email, contact, notes, product)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             status   = IF(status = 'captured' AND VALUES(status) IN ('created','authorized'), status, VALUES(status)),
             method   = COALESCE(VALUES(method), method),
             plan_id  = COALESCE(VALUES(plan_id), plan_id),
             plan_name = COALESCE(VALUES(plan_name), plan_name),
             razorpay_subscription_id = COALESCE(VALUES(razorpay_subscription_id), razorpay_subscription_id),
             amount   = VALUES(amount),
             currency = VALUES(currency),
             id = LAST_INSERT_ID(id)`,
        values
    );
    return result.insertId;
}
