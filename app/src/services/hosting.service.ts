import { query } from '../config/database';
import { generateInvoicePDF } from './pdf.service';
import { sendInvoiceEmail } from './mailer.service';
import { getRazorpayClient } from './razorpay.service';
import { getCompanyConfig } from './payment-settings.service';

// ─── Hosting product ──────────────────────────────────────────────────────────
// Second product line: on-demand hosting. Plans are admin-managed and the
// service is enabled per tenant (tenants.hosting_enabled). Billing reuses the
// same Razorpay/demo gateway as search subscriptions.

let migrated = false;
export async function ensureHostingTables() {
    if (migrated) return;

    await query(`
        CREATE TABLE IF NOT EXISTS hosting_plans (
            id                        INT AUTO_INCREMENT PRIMARY KEY,
            name                      VARCHAR(100) NOT NULL,
            price                     DECIMAL(10,2) NOT NULL,
            storage_gb                INT NOT NULL DEFAULT 0,
            ram_gb                    DECIMAL(6,1) NOT NULL DEFAULT 0,
            bandwidth                 VARCHAR(50) NOT NULL DEFAULT 'Unlimited',
            billing_period            ENUM('monthly','yearly') NOT NULL DEFAULT 'monthly',
            is_active                 BOOLEAN DEFAULT TRUE,
            razorpay_plan_id          VARCHAR(64) NULL,
            razorpay_plan_fingerprint VARCHAR(100) NULL,
            created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS hosting_subscriptions (
            id                       INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id                INT NOT NULL,
            hosting_plan_id          INT NOT NULL,
            status                   ENUM('active','past_due','cancelled') NOT NULL DEFAULT 'active',
            current_period_start     DATETIME,
            current_period_end       DATETIME,
            razorpay_subscription_id VARCHAR(64) NULL,
            cancelled_at             DATETIME,
            created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            FOREIGN KEY (hosting_plan_id) REFERENCES hosting_plans(id),
            INDEX idx_tenant (tenant_id),
            INDEX idx_status (status),
            INDEX idx_rzp_sub (razorpay_subscription_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Per-tenant product flags: hosting is opt-in, search is on by default.
    // A hosting-only client = search_enabled FALSE + hosting_enabled TRUE.
    try { await query('ALTER TABLE tenants ADD COLUMN hosting_enabled BOOLEAN NOT NULL DEFAULT FALSE'); } catch (_) { /* exists */ }
    try { await query('ALTER TABLE tenants ADD COLUMN search_enabled BOOLEAN NOT NULL DEFAULT TRUE'); } catch (_) { /* exists */ }

    // Distinguish products in the shared orders table
    try { await query("ALTER TABLE orders ADD COLUMN product VARCHAR(20) NOT NULL DEFAULT 'search'"); } catch (_) { /* exists */ }

    migrated = true;
}

function makeInvoiceNumber(id: number): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${String(id).padStart(5, '0')}`;
}

// ─── Activate a hosting subscription ──────────────────────────────────────────
// Used by demo purchase, Razorpay verify, and webhook renewals.
export async function activateHostingSubscription(opts: {
    tenantId: number;
    plan: any; // hosting_plans row
    currency?: string;
    billingReason?: string;
    razorpaySubscriptionId?: string | null;
}) {
    const { tenantId, plan } = opts;
    const currency = opts.currency || 'USD';
    const billingReason = opts.billingReason || 'hosting_create';

    await ensureHostingTables();

    const tenants: any = await query('SELECT store_name, email FROM tenants WHERE id = ?', [tenantId]);
    if (!tenants || tenants.length === 0) throw new Error('Tenant not found');
    const tenant = tenants[0];

    // Plan change: stop the OLD recurring mandate at the gateway too, otherwise
    // Razorpay keeps auto-charging the replaced hosting subscription.
    const oldSubs: any = await query(
        "SELECT razorpay_subscription_id FROM hosting_subscriptions WHERE tenant_id = ? AND status = 'active' AND razorpay_subscription_id IS NOT NULL",
        [tenantId]
    );
    for (const old of oldSubs) {
        if (old.razorpay_subscription_id && old.razorpay_subscription_id !== opts.razorpaySubscriptionId) {
            try {
                const { client } = await getRazorpayClient();
                await client.subscriptions.cancel(old.razorpay_subscription_id, false); // immediate — replaced by new plan
            } catch (e: any) {
                console.warn('Old hosting subscription gateway cancel warning:', e?.error?.description || e?.message);
            }
        }
    }

    // Cancel any existing active hosting subscription
    await query(
        "UPDATE hosting_subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE tenant_id = ? AND status = 'active'",
        [tenantId]
    );

    const periodStart = new Date();
    const periodEnd = new Date();
    if (plan.billing_period === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    await query(
        `INSERT INTO hosting_subscriptions (tenant_id, hosting_plan_id, status, current_period_start, current_period_end, razorpay_subscription_id)
         VALUES (?, ?, 'active', ?, ?, ?)`,
        [tenantId, plan.id, periodStart, periodEnd, opts.razorpaySubscriptionId || null]
    );

    // Invoice (shared invoices table, prefixed plan name)
    const invoicePlanName = `Hosting — ${plan.name}`;
    const invResult: any = await query(
        `INSERT INTO invoices (tenant_id, invoice_number, plan_name, billing_reason, amount, currency, status, period_start, period_end, paid_at)
         VALUES (?, 'TEMP', ?, ?, ?, ?, 'paid', ?, ?, NOW())`,
        [tenantId, invoicePlanName, billingReason, plan.price, currency, periodStart, periodEnd]
    );
    const invoiceId = invResult.insertId;
    const invoiceNumber = makeInvoiceNumber(invoiceId);
    await query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [invoiceNumber, invoiceId]);

    // PDF + email (fire-and-forget)
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
            description: `${invoicePlanName} (${plan.storage_gb}GB storage · ${plan.ram_gb}GB RAM · ${plan.bandwidth} data)`,
            period: `${periodStart.toLocaleDateString()} – ${periodEnd.toLocaleDateString()}`,
            amount: parseFloat(plan.price),
        }],
    })
        .then((pdfBuffer) =>
            sendInvoiceEmail(tenant.email, tenant.store_name, invoiceNumber, invoicePlanName, parseFloat(plan.price), pdfBuffer)
        )
        .catch((e) => console.error('Hosting invoice email error:', e));

    return { invoiceNumber, periodStart, periodEnd, tenant };
}
