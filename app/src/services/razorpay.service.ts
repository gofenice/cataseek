import Razorpay from 'razorpay';
import crypto from 'crypto';
import { query } from '../config/database';
import { getRazorpayConfig, RazorpayConfig } from './payment-settings.service';

// ─── Razorpay client (credentials come from admin-configured DB settings) ─────
export async function getRazorpayClient(): Promise<{ client: Razorpay; config: RazorpayConfig }> {
    const config = await getRazorpayConfig();
    if (!config.key_id || !config.key_secret) {
        throw new Error('Razorpay is not configured. Set API keys in Admin → Payment Settings.');
    }
    const client = new Razorpay({ key_id: config.key_id, key_secret: config.key_secret });
    return { client, config };
}

// ─── Lazy migrations ──────────────────────────────────────────────────────────
let migrated = false;
export async function ensurePaymentTables() {
    if (migrated) return;

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

    // plans: store the mapped Razorpay plan id + a fingerprint (price/period/currency)
    // so we re-create the Razorpay plan when pricing changes (rzp plans are immutable).
    try { await query("ALTER TABLE plans ADD COLUMN razorpay_plan_id VARCHAR(64) NULL"); } catch (_) { /* exists */ }
    try { await query("ALTER TABLE plans ADD COLUMN razorpay_plan_fingerprint VARCHAR(100) NULL"); } catch (_) { /* exists */ }

    // subscriptions: track the Razorpay subscription id alongside the stripe one
    try { await query("ALTER TABLE subscriptions ADD COLUMN razorpay_subscription_id VARCHAR(64) NULL"); } catch (_) { /* exists */ }
    try { await query("ALTER TABLE subscriptions ADD INDEX idx_rzp_sub (razorpay_subscription_id)"); } catch (_) { /* exists */ }

    migrated = true;
}

// ─── Plan mapping ─────────────────────────────────────────────────────────────
// Razorpay plans are immutable, so we create one per local plan and re-create it
// whenever price/billing_period/currency change (detected via fingerprint).
// `table` selects which local table holds the plan ('plans' or 'hosting_plans').
export async function ensureRazorpayPlan(plan: any, table: 'plans' | 'hosting_plans' = 'plans'): Promise<string> {
    const { client, config } = await getRazorpayClient();
    await ensurePaymentTables();

    const fingerprint = `${plan.price}|${plan.billing_period}|${config.currency}`;
    if (plan.razorpay_plan_id && plan.razorpay_plan_fingerprint === fingerprint) {
        return plan.razorpay_plan_id;
    }

    const namePrefix = table === 'hosting_plans' ? 'Hosting — ' : '';
    const rzpPlan: any = await client.plans.create({
        period: plan.billing_period === 'yearly' ? 'yearly' : 'monthly',
        interval: 1,
        item: {
            name: `${namePrefix}${plan.name} Plan`,
            description: (plan.description || '').slice(0, 250) || undefined,
            amount: Math.round(Number(plan.price) * 100), // smallest currency unit
            currency: config.currency,
        },
        notes: { local_plan_id: String(plan.id), local_table: table },
    });

    await query(
        `UPDATE ${table} SET razorpay_plan_id = ?, razorpay_plan_fingerprint = ? WHERE id = ?`,
        [rzpPlan.id, fingerprint, plan.id]
    );

    return rzpPlan.id;
}

// ─── Subscription creation ────────────────────────────────────────────────────
// When `upfront` is set (plan-change credit), the subscription starts at the
// NEXT cycle (startAt) and the discounted first cycle is collected immediately
// as an addon on the authentication transaction.
export async function createRazorpaySubscription(
    tenant: any,
    plan: any,
    opts: {
        table?: 'plans' | 'hosting_plans';
        product?: 'search' | 'hosting';
        startAt?: number; // unix seconds — recurring charges begin here
        upfront?: { amount: number; label: string }; // collected at checkout
    } = {}
): Promise<any> {
    const { client, config } = await getRazorpayClient();
    const rzpPlanId = await ensureRazorpayPlan(plan, opts.table || 'plans');

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
// Checkout handler signature: HMAC_SHA256(payment_id + '|' + subscription_id, key_secret)
export function verifySubscriptionSignature(paymentId: string, subscriptionId: string, signature: string, keySecret: string): boolean {
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${paymentId}|${subscriptionId}`)
        .digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
        return false;
    }
}

// Webhook signature: HMAC_SHA256(raw_body, webhook_secret)
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string, webhookSecret: string): boolean {
    const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
        return false;
    }
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
    // Make sure the product column exists (added by hosting migration)
    try { await query("ALTER TABLE orders ADD COLUMN product VARCHAR(20) NOT NULL DEFAULT 'search'"); } catch (_) { /* exists */ }

    // Upsert by payment id so webhook + verify don't duplicate the same payment
    if (o.razorpayPaymentId) {
        const existing: any = await query(
            'SELECT id FROM orders WHERE razorpay_payment_id = ? LIMIT 1',
            [o.razorpayPaymentId]
        );
        if (existing && existing.length > 0) {
            await query(
                `UPDATE orders SET status = ?, method = COALESCE(?, method), amount = ?, currency = ? WHERE id = ?`,
                [o.status, o.method || null, o.amount, o.currency, existing[0].id]
            );
            return existing[0].id;
        }
    }

    const result: any = await query(
        `INSERT INTO orders (tenant_id, plan_id, plan_name, razorpay_subscription_id, razorpay_payment_id, razorpay_order_id,
                             amount, currency, status, method, email, contact, notes, product)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            o.tenantId, o.planId || null, o.planName || null,
            o.razorpaySubscriptionId || null, o.razorpayPaymentId || null, o.razorpayOrderId || null,
            o.amount, o.currency, o.status, o.method || null, o.email || null, o.contact || null, o.notes || null,
            o.product || 'search',
        ]
    );
    return result.insertId;
}
