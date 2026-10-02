import express, { Response } from 'express';
import multer from 'multer';
import { query } from '../config/database';
import { MODULES_DIR, removeModuleFile } from '../services/modules.service';
import { authenticateJWT, requireAdmin, AuthRequest } from '../middleware/auth';
import { deleteTenantIndex } from '../config/meilisearch';
import { getRazorpayConfig, saveRazorpayConfig, maskSecret, getCompanyConfig, saveCompanyConfig, modeFromKeyId } from '../services/payment-settings.service';
import {
    getRazorpayClient,
    ensurePaymentTables,
    setPlanMapping,
    comparePlan,
    createAndMapRazorpayPlan,
    PlanMappingError,
    PlanTable,
} from '../services/razorpay.service';
import { ensureHostingTables } from '../services/hosting.service';
import { syncYearlyVariant } from '../services/plan-sync.service';
import { getGoogleAuthConfig, saveGoogleAuthConfig } from '../services/google-auth-settings.service';
import {
    SUPPORTED_CURRENCIES,
    getEnabledCurrencies,
    localizePlan,
    saveExtraCurrencies,
    setPlanPrice,
} from '../services/currency.service';

const router = express.Router();

// All admin routes require JWT + admin role
router.use(authenticateJWT, requireAdmin);

// ─── GET /api/admin/stats ────────────────────────────────────────────────────
// Global platform stats
router.get('/stats', async (req: AuthRequest, res: Response) => {
    try {
        const [tenantStats]: any = await query(`
      SELECT
        COUNT(*) AS total_tenants,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_tenants,
        SUM(CASE WHEN status = 'trial'  THEN 1 ELSE 0 END) AS trial_tenants,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_tenants
      FROM tenants
      WHERE role = 'merchant'
    `);

        const [requestStats]: any = await query(`
      SELECT
        SUM(request_count) AS total_requests_all_time,
        SUM(CASE WHEN date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN request_count ELSE 0 END) AS requests_this_month
      FROM api_usage
    `);

        const plans: any = await query(`
      SELECT p.name, COUNT(s.id) AS subscriber_count, p.price
      FROM plans p
      LEFT JOIN subscriptions s ON p.id = s.plan_id AND s.status = 'active'
      GROUP BY p.id
    `);

        res.json({
            tenants: tenantStats[0] ?? tenantStats,
            requests: requestStats[0] ?? requestStats,
            plans,
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ─── GET /api/admin/tenants ──────────────────────────────────────────────────
// List all merchant tenants with plan info
router.get('/tenants', async (req: AuthRequest, res: Response) => {
    try {
        const search = (req.query.search as string) || '';
        const status = (req.query.status as string) || '';
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = (page - 1) * limit;

        let where = "t.role = 'merchant'";
        const params: any[] = [];

        if (search) {
            where += ' AND (t.store_name LIKE ? OR t.email LIKE ? OR t.store_domain LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (status) {
            where += ' AND t.status = ?';
            params.push(status);
        }

        const tenants: any = await query(
            `SELECT t.id, t.store_name, t.store_domain, t.email, t.status, t.trial_ends_at,
              t.meilisearch_index_name, t.created_at,
              p.name AS plan_name, p.price AS plan_price,
              (SELECT SUM(request_count) FROM api_usage WHERE tenant_id = t.id
               AND date >= DATE_FORMAT(NOW(),'%Y-%m-01')) AS requests_this_month
       FROM tenants t
       LEFT JOIN subscriptions s ON t.id = s.tenant_id AND s.status = 'active'
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const countResult: any = await query(
            `SELECT COUNT(*) AS total FROM tenants t WHERE ${where}`,
            params
        );

        res.json({
            tenants,
            pagination: {
                total: countResult[0].total,
                page,
                limit,
                pages: Math.ceil(countResult[0].total / limit),
            },
        });
    } catch (error) {
        console.error('Admin tenant list error:', error);
        res.status(500).json({ error: 'Failed to fetch tenants' });
    }
});

// ─── GET /api/admin/tenants/:id ──────────────────────────────────────────────
// Full details for a single tenant
router.get('/tenants/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const rows: any = await query(
            `SELECT t.*,
              p.name AS plan_name, p.price AS plan_price,
              p.max_products, p.max_requests_per_month,
              s.status AS sub_status, s.current_period_end
       FROM tenants t
       LEFT JOIN subscriptions s ON t.id = s.tenant_id AND s.status = 'active'
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE t.id = ? AND t.role = 'merchant'`,
            [id]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // API usage — last 30 days by day
        const usage: any = await query(
            `SELECT date, SUM(request_count) AS requests
       FROM api_usage
       WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY date ORDER BY date ASC`,
            [id]
        );

        // Product count
        const tableName = `products_${id}`;
        let productCount = 0;
        try {
            const countRes: any = await query(`SELECT COUNT(*) AS cnt FROM ${tableName}`);
            productCount = countRes[0]?.cnt ?? 0;
        } catch (_) { /* table may not exist yet */ }

        res.json({
            tenant: rows[0],
            usage,
            productCount,
        });
    } catch (error) {
        console.error('Admin tenant detail error:', error);
        res.status(500).json({ error: 'Failed to fetch tenant details' });
    }
});

// ─── PATCH /api/admin/tenants/:id ────────────────────────────────────────────
// Edit a tenant (status, plan, store_name, store_domain)
router.patch('/tenants/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status, store_name, store_domain, plan_id, hosting_enabled, search_enabled } = req.body;

        const allowed: Record<string, any> = {};
        if (status) allowed.status = status;
        if (store_name) allowed.store_name = store_name;
        if (store_domain) allowed.store_domain = store_domain;
        if (hosting_enabled !== undefined || search_enabled !== undefined) {
            await ensureHostingTables(); // makes sure the columns exist
            if (hosting_enabled !== undefined) allowed.hosting_enabled = hosting_enabled ? 1 : 0;
            if (search_enabled !== undefined) allowed.search_enabled = search_enabled ? 1 : 0;
        }

        if (Object.keys(allowed).length > 0) {
            const setClauses = Object.keys(allowed).map(k => `${k} = ?`).join(', ');
            await query(
                `UPDATE tenants SET ${setClauses}, updated_at = NOW() WHERE id = ?`,
                [...Object.values(allowed), id]
            );
        }

        // Change plan — update subscriptions table
        if (plan_id) {
            const existingSub: any = await query(
                "SELECT id FROM subscriptions WHERE tenant_id = ? AND status = 'active'",
                [id]
            );
            if (existingSub && existingSub.length > 0) {
                await query("UPDATE subscriptions SET plan_id = ? WHERE tenant_id = ? AND status = 'active'", [plan_id, id]);
            } else {
                const period_end = new Date();
                period_end.setMonth(period_end.getMonth() + 1);
                await query(
                    `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
           VALUES (?, ?, 'active', NOW(), ?)`,
                    [id, plan_id, period_end]
                );
            }
            await query('UPDATE tenants SET plan_id = ? WHERE id = ?', [plan_id, id]);
        }

        res.json({ message: 'Tenant updated successfully' });
    } catch (error) {
        console.error('Admin tenant edit error:', error);
        res.status(500).json({ error: 'Failed to update tenant' });
    }
});

// ─── DELETE /api/admin/tenants/:id ───────────────────────────────────────────
// Suspend or permanently delete + wipe a tenant
router.delete('/tenants/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { action } = req.query; // 'suspend' or 'delete'

        if (action === 'delete') {
            // 1. Fetch the tenant's Meilisearch index name before we delete anything
            const tenantRows: any = await query(
                'SELECT meilisearch_index_name FROM tenants WHERE id = ? AND role = ?',
                [id, 'merchant']
            );

            if (!tenantRows || tenantRows.length === 0) {
                return res.status(404).json({ error: 'Tenant not found' });
            }

            const indexName: string | null = tenantRows[0].meilisearch_index_name;

            // 1b. Stop every live gateway subscription first (paid, trial-scheduled or
            //     paused) — otherwise Razorpay keeps charging a deleted customer.
            try {
                await ensureHostingTables();
                const liveSubs: any = await query(
                    `SELECT razorpay_subscription_id FROM subscriptions WHERE tenant_id = ? AND status IN ('active','trialing','past_due') AND razorpay_subscription_id IS NOT NULL
                     UNION
                     SELECT razorpay_subscription_id FROM hosting_subscriptions WHERE tenant_id = ? AND status IN ('active','trialing','past_due') AND razorpay_subscription_id IS NOT NULL`,
                    [id, id]
                );
                if (liveSubs.length > 0) {
                    const { client } = await getRazorpayClient();
                    for (const s of liveSubs) {
                        try {
                            await client.subscriptions.cancel(s.razorpay_subscription_id, false);
                        } catch (e: any) {
                            console.warn(`[Delete Tenant] gateway cancel ${s.razorpay_subscription_id}:`, e?.error?.description || e?.message);
                        }
                    }
                }
            } catch (e: any) {
                console.warn('[Delete Tenant] could not cancel gateway subscriptions:', e?.message);
            }

            // 2. Drop the tenant's dedicated products table (won't error if it doesn't exist)
            try {
                await query(`DROP TABLE IF EXISTS products_${id}`);
                console.log(`[Delete Tenant] Dropped table products_${id}`);
            } catch (e) {
                console.warn(`[Delete Tenant] Could not drop products_${id}:`, e);
            }

            // 3. Delete the Meilisearch index (won't error if it doesn't exist)
            if (indexName) {
                try {
                    await deleteTenantIndex(indexName);
                    console.log(`[Delete Tenant] Deleted Meilisearch index: ${indexName}`);
                } catch (e) {
                    console.warn(`[Delete Tenant] Could not delete Meilisearch index ${indexName}:`, e);
                }
            }

            // 4. Delete the tenant row — CASCADE wipes subscriptions, invoices, api_usage, tenant_settings
            await query('DELETE FROM tenants WHERE id = ? AND role = ?', [id, 'merchant']);
            console.log(`[Delete Tenant] Permanently deleted tenant ID: ${id}`);

            res.json({ message: 'Tenant permanently removed. All data has been wiped.' });
        } else {
            // Default action: suspend
            await query("UPDATE tenants SET status = 'suspended' WHERE id = ?", [id]);
            res.json({ message: 'Tenant suspended' });
        }
    } catch (error) {
        console.error('Admin tenant delete error:', error);
        res.status(500).json({ error: 'Failed to remove tenant' });
    }
});

// ─── GET /api/admin/plans ────────────────────────────────────────────────────
router.get('/plans', async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        const plans: any = await query('SELECT * FROM plans ORDER BY price ASC');
        res.json({ plans });
    } catch (error) {
        console.error('Admin plans list error:', error);
        res.status(500).json({ error: 'Failed to fetch plans' });
    }
});

// ─── POST /api/admin/plans ────────────────────────────────────────────────────
// Yearly billing: only monthly plans are directly created here. A yearly
// sibling (parent_plan_id → this row) is auto-generated from
// yearly_discount_percent — see syncYearlyVariant.
router.post('/plans', async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        const { name, description, price, max_products, max_requests_per_month, features, yearly_discount_percent } = req.body;
        if (!name || price == null || !max_requests_per_month) {
            return res.status(400).json({ error: 'name, price, and max_requests_per_month are required' });
        }
        const discount = Math.min(99, Math.max(0, Number(yearly_discount_percent) || 0));
        const result: any = await query(
            `INSERT INTO plans (name, description, price, billing_period, max_products, max_requests_per_month, features, yearly_discount_percent, is_active)
       VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, TRUE)`,
            [name, description || '', price, max_products || 0, max_requests_per_month, JSON.stringify(features || []), discount]
        );
        await syncYearlyVariant('plans', result.insertId);
        res.status(201).json({ message: 'Plan created', id: result.insertId });
    } catch (error) {
        console.error('Admin plan create error:', error);
        res.status(500).json({ error: 'Failed to create plan' });
    }
});

// ─── PATCH /api/admin/plans/:id ───────────────────────────────────────────────
router.patch('/plans/:id', async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        const { id } = req.params;

        const existing: any = await query('SELECT parent_plan_id FROM plans WHERE id = ?', [id]);
        if (!existing || existing.length === 0) {
            return res.status(404).json({ error: 'Plan not found' });
        }
        if (existing[0].parent_plan_id !== null) {
            return res.status(400).json({ error: 'Yearly plans are auto-generated — edit the monthly plan instead.' });
        }

        const { name, description, price, max_products, max_requests_per_month, features, is_active, yearly_discount_percent } = req.body;

        const allowed: Record<string, any> = {};
        if (name !== undefined) allowed.name = name;
        if (description !== undefined) allowed.description = description;
        if (price !== undefined) allowed.price = price;
        if (max_products !== undefined) allowed.max_products = max_products;
        if (max_requests_per_month !== undefined) allowed.max_requests_per_month = max_requests_per_month;
        if (features !== undefined) allowed.features = JSON.stringify(features);
        if (is_active !== undefined) allowed.is_active = is_active ? 1 : 0;
        if (yearly_discount_percent !== undefined) allowed.yearly_discount_percent = Math.min(99, Math.max(0, Number(yearly_discount_percent) || 0));

        if (Object.keys(allowed).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const setClauses = Object.keys(allowed).map(k => `${k} = ?`).join(', ');
        await query(`UPDATE plans SET ${setClauses}, updated_at = NOW() WHERE id = ?`, [...Object.values(allowed), id]);
        await syncYearlyVariant('plans', Number(id));
        res.json({ message: 'Plan updated' });
    } catch (error) {
        console.error('Admin plan update error:', error);
        res.status(500).json({ error: 'Failed to update plan' });
    }
});

// ─── DELETE /api/admin/plans/:id (deactivate) ────────────────────────────────
router.delete('/plans/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const existing: any = await query('SELECT parent_plan_id FROM plans WHERE id = ?', [id]);
        if (!existing || existing.length === 0) {
            return res.status(404).json({ error: 'Plan not found' });
        }
        if (existing[0].parent_plan_id !== null) {
            return res.status(400).json({ error: 'Yearly plans are auto-generated — deactivate the monthly plan instead.' });
        }
        await query('UPDATE plans SET is_active = FALSE WHERE id = ?', [id]);
        await syncYearlyVariant('plans', Number(id)); // cascades is_active to the yearly sibling
        res.json({ message: 'Plan deactivated' });
    } catch (error) {
        console.error('Admin plan deactivate error:', error);
        res.status(500).json({ error: 'Failed to deactivate plan' });
    }
});

// ─── Hosting plans CRUD ──────────────────────────────────────────────────────
// Second product line: on-demand hosting (Amount, Size, RAM, Data)

// GET /api/admin/hosting-plans
router.get('/hosting-plans', async (req: AuthRequest, res: Response) => {
    try {
        await ensureHostingTables();
        const plans: any = await query("SELECT * FROM hosting_plans WHERE billing_period = 'monthly' ORDER BY price ASC");

        // Count of tenants with hosting enabled (for the page header)
        const [enabledCount]: any = await query(
            "SELECT COUNT(*) AS cnt FROM tenants WHERE hosting_enabled = TRUE AND role = 'merchant'"
        );
        const [activeSubs]: any = await query(
            "SELECT COUNT(*) AS cnt FROM hosting_subscriptions WHERE status = 'active'"
        );

        res.json({
            plans,
            stats: {
                enabled_tenants: enabledCount[0]?.cnt ?? 0,
                active_subscriptions: activeSubs[0]?.cnt ?? 0,
            },
        });
    } catch (error) {
        console.error('Admin hosting plans list error:', error);
        res.status(500).json({ error: 'Failed to fetch hosting plans' });
    }
});

// POST /api/admin/hosting-plans — hosting is sold monthly only
router.post('/hosting-plans', async (req: AuthRequest, res: Response) => {
    try {
        await ensureHostingTables();
        const { name, price, storage_gb, ram_gb, bandwidth } = req.body;

        if (!name || price == null || storage_gb == null || ram_gb == null) {
            return res.status(400).json({ error: 'name, price, storage_gb, and ram_gb are required' });
        }

        const result: any = await query(
            `INSERT INTO hosting_plans (name, price, storage_gb, ram_gb, bandwidth, billing_period, is_active)
             VALUES (?, ?, ?, ?, ?, 'monthly', TRUE)`,
            [name, price, storage_gb, ram_gb, bandwidth || 'Unlimited']
        );
        res.status(201).json({ message: 'Hosting plan created', id: result.insertId });
    } catch (error) {
        console.error('Admin hosting plan create error:', error);
        res.status(500).json({ error: 'Failed to create hosting plan' });
    }
});

// PATCH /api/admin/hosting-plans/:id
router.patch('/hosting-plans/:id', async (req: AuthRequest, res: Response) => {
    try {
        await ensureHostingTables();
        const { id } = req.params;

        const existing: any = await query("SELECT id FROM hosting_plans WHERE id = ? AND billing_period = 'monthly'", [id]);
        if (!existing || existing.length === 0) {
            return res.status(404).json({ error: 'Hosting plan not found' });
        }

        const { name, price, storage_gb, ram_gb, bandwidth, is_active } = req.body;

        const allowed: Record<string, any> = {};
        if (name !== undefined) allowed.name = name;
        if (price !== undefined) allowed.price = price;
        if (storage_gb !== undefined) allowed.storage_gb = storage_gb;
        if (ram_gb !== undefined) allowed.ram_gb = ram_gb;
        if (bandwidth !== undefined) allowed.bandwidth = bandwidth;
        if (is_active !== undefined) allowed.is_active = is_active ? 1 : 0;

        if (Object.keys(allowed).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const setClauses = Object.keys(allowed).map(k => `${k} = ?`).join(', ');
        await query(`UPDATE hosting_plans SET ${setClauses}, updated_at = NOW() WHERE id = ?`, [...Object.values(allowed), id]);
        res.json({ message: 'Hosting plan updated' });
    } catch (error) {
        console.error('Admin hosting plan update error:', error);
        res.status(500).json({ error: 'Failed to update hosting plan' });
    }
});

// DELETE /api/admin/hosting-plans/:id (deactivate)
router.delete('/hosting-plans/:id', async (req: AuthRequest, res: Response) => {
    try {
        await ensureHostingTables();
        const { id } = req.params;
        const existing: any = await query("SELECT id FROM hosting_plans WHERE id = ? AND billing_period = 'monthly'", [id]);
        if (!existing || existing.length === 0) {
            return res.status(404).json({ error: 'Hosting plan not found' });
        }
        await query('UPDATE hosting_plans SET is_active = FALSE WHERE id = ?', [id]);
        res.json({ message: 'Hosting plan deactivated' });
    } catch (error) {
        console.error('Admin hosting plan deactivate error:', error);
        res.status(500).json({ error: 'Failed to deactivate hosting plan' });
    }
});

// ─── GET /api/admin/payment-settings ─────────────────────────────────────────
// Razorpay gateway config (secrets masked for display)
router.get('/payment-settings', async (req: AuthRequest, res: Response) => {
    try {
        const config = await getRazorpayConfig(true);
        res.json({
            settings: {
                enabled: config.enabled,
                mode: config.mode,
                key_id: config.key_id,
                key_secret_masked: maskSecret(config.key_secret),
                webhook_secret_masked: maskSecret(config.webhook_secret),
                currency: config.currency,
                has_key_secret: !!config.key_secret,
                has_webhook_secret: !!config.webhook_secret,
                key_source: config.key_source,
            },
        });
    } catch (error) {
        console.error('Payment settings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch payment settings' });
    }
});

// ─── PUT /api/admin/payment-settings ─────────────────────────────────────────
// Save Razorpay config. Empty secret fields are ignored (keep existing value).
router.put('/payment-settings', async (req: AuthRequest, res: Response) => {
    try {
        const { enabled, mode, key_id, key_secret, webhook_secret, currency } = req.body;

        if (mode !== undefined && !['test', 'live'].includes(mode)) {
            return res.status(400).json({ error: "mode must be 'test' or 'live'" });
        }
        if (key_id !== undefined && key_id && !/^rzp_(test|live)_/.test(key_id)) {
            return res.status(400).json({ error: 'key_id should start with rzp_test_ or rzp_live_' });
        }
        // Mode follows the key prefix — reject a combination that can't work
        const keyMode = key_id ? modeFromKeyId(String(key_id)) : null;
        if (keyMode && mode && keyMode !== mode) {
            return res.status(400).json({ error: `Mode is '${mode}' but the key id is a ${keyMode} key` });
        }

        await saveRazorpayConfig({ enabled, mode, key_id, key_secret, webhook_secret, currency });
        res.json({ message: 'Payment settings saved' });
    } catch (error) {
        console.error('Payment settings save error:', error);
        res.status(500).json({ error: 'Failed to save payment settings' });
    }
});

// ─── GET/PUT /api/admin/company-settings ─────────────────────────────────────
// Company identity + tax (GST) details shown on invoices
router.get('/company-settings', async (req: AuthRequest, res: Response) => {
    try {
        const c = await getCompanyConfig(true);
        res.json({ settings: c });
    } catch (error) {
        console.error('Company settings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch company settings' });
    }
});

router.put('/company-settings', async (req: AuthRequest, res: Response) => {
    try {
        const { company_name, company_email, company_address, company_gstin, tax_rate, tax_label } = req.body;
        if (tax_rate !== undefined && (isNaN(Number(tax_rate)) || Number(tax_rate) < 0 || Number(tax_rate) > 100)) {
            return res.status(400).json({ error: 'tax_rate must be between 0 and 100' });
        }
        await saveCompanyConfig({ company_name, company_email, company_address, company_gstin, tax_rate, tax_label });
        res.json({ message: 'Company settings saved' });
    } catch (error) {
        console.error('Company settings save error:', error);
        res.status(500).json({ error: 'Failed to save company settings' });
    }
});

// ─── GET/PUT /api/admin/google-auth-settings ─────────────────────────────────
// Google Sign-In config. No secret involved — the client-side GIS flow only
// needs a Client ID (not secret information), so nothing here needs masking.
router.get('/google-auth-settings', async (req: AuthRequest, res: Response) => {
    try {
        const config = await getGoogleAuthConfig(true);
        res.json({ settings: config });
    } catch (error) {
        console.error('Google auth settings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch Google sign-in settings' });
    }
});

router.put('/google-auth-settings', async (req: AuthRequest, res: Response) => {
    try {
        const { enabled, clientId } = req.body;
        if (enabled === true && !String(clientId || '').trim()) {
            return res.status(400).json({ error: 'A Client ID is required to enable Google sign-in' });
        }
        await saveGoogleAuthConfig({ enabled, clientId });
        res.json({ message: 'Google sign-in settings saved' });
    } catch (error) {
        console.error('Google auth settings save error:', error);
        res.status(500).json({ error: 'Failed to save Google sign-in settings' });
    }
});

// ─── POST /api/admin/payment-settings/test ───────────────────────────────────
// Verify the stored credentials actually work against the Razorpay API
router.post('/payment-settings/test', async (req: AuthRequest, res: Response) => {
    try {
        const { client } = await getRazorpayClient();
        await client.plans.all({ count: 1 }); // any authenticated call works as a ping
        res.json({ ok: true, message: 'Connection successful — Razorpay credentials are valid.' });
    } catch (error: any) {
        const detail = error?.error?.description || error?.message || 'Unknown error';
        res.status(400).json({ ok: false, error: `Connection failed: ${detail}` });
    }
});

// ─── Razorpay plan mapping + currency prices ─────────────────────────────────
// Each Cataseek plan (search + hosting) maps to one Razorpay plan per mode AND
// currency. The base currency price is the plan's own price; other currencies
// have a fixed price set here. Checkout never creates Razorpay plans.
const PLAN_TABLES: PlanTable[] = ['plans', 'hosting_plans'];

// Hosting is monthly only; yearly rows left from the old auto-generation are not sold
const sellableFilter = (table: PlanTable) => (table === 'hosting_plans' ? "WHERE billing_period = 'monthly'" : '');

async function loadSellablePlan(table: PlanTable, planId: any): Promise<any | null> {
    const filter = sellableFilter(table);
    const rows: any = await query(`SELECT * FROM ${table} ${filter ? `${filter} AND` : 'WHERE'} id = ?`, [planId]);
    return rows?.[0] || null;
}

function parseCurrency(value: any, allowed: string[]): string | null {
    const currency = String(value || '').toUpperCase();
    return allowed.includes(currency) ? currency : null;
}

// GET /api/admin/razorpay/plan-mappings
router.get('/razorpay/plan-mappings', async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        await ensureHostingTables();
        const config = await getRazorpayConfig(true);
        const enabled = await getEnabledCurrencies(true);
        const base = enabled[0];
        const currencies = [base, ...SUPPORTED_CURRENCIES.filter((c) => c !== base)];

        const mappings: any = await query('SELECT mode, plan_table, local_plan_id, currency, razorpay_plan_id FROM razorpay_plan_mappings');
        const prices: any = await query('SELECT plan_table, local_plan_id, currency, price FROM plan_prices');
        const plans: any[] = [];
        for (const table of PLAN_TABLES) {
            const rows: any = await query(`SELECT id, name, price, billing_period, is_active FROM ${table} ${sellableFilter(table)} ORDER BY billing_period, price`);
            for (const p of rows) {
                const mine = (x: any) => x.plan_table === table && Number(x.local_plan_id) === Number(p.id);
                const priceByCurrency: Record<string, string | null> = {};
                const planIds: Record<string, Record<string, string | null>> = { test: {}, live: {} };
                for (const currency of currencies) {
                    priceByCurrency[currency] = currency === base
                        ? p.price
                        : prices.find((x: any) => mine(x) && x.currency === currency)?.price ?? null;
                    for (const mode of ['test', 'live']) {
                        planIds[mode][currency] = mappings.find((m: any) => mine(m) && m.mode === mode && m.currency === currency)?.razorpay_plan_id || null;
                    }
                }
                plans.push({ table, ...p, prices: priceByCurrency, plan_ids: planIds });
            }
        }
        res.json({ mode: config.mode, currency: base, currencies, enabled_currencies: enabled, plans });
    } catch (error) {
        console.error('Plan mapping list error:', error);
        res.status(500).json({ error: 'Failed to fetch plan mappings' });
    }
});

// PUT /api/admin/razorpay/plan-mappings  { table, planId, mode, currency, razorpayPlanId }  (empty id = unmap)
router.put('/razorpay/plan-mappings', async (req: AuthRequest, res: Response) => {
    try {
        const { table, planId, mode, razorpayPlanId } = req.body;
        if (!PLAN_TABLES.includes(table)) return res.status(400).json({ error: 'table must be plans or hosting_plans' });
        if (!['test', 'live'].includes(mode)) return res.status(400).json({ error: "mode must be 'test' or 'live'" });
        const base = (await getEnabledCurrencies())[0];
        const currency = parseCurrency(req.body.currency || base, [base, ...SUPPORTED_CURRENCIES]);
        if (!currency) return res.status(400).json({ error: 'Unsupported currency' });
        if (!(await loadSellablePlan(table, planId))) return res.status(404).json({ error: 'Plan not found' });
        await setPlanMapping(mode, table, Number(planId), currency, String(razorpayPlanId || '').trim() || null);
        res.json({ message: 'Plan mapping saved' });
    } catch (error: any) {
        if (error instanceof PlanMappingError) return res.status(400).json({ error: error.message });
        if (error?.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'That Razorpay plan is already mapped to another Cataseek plan or currency' });
        console.error('Plan mapping save error:', error);
        res.status(500).json({ error: 'Failed to save plan mapping' });
    }
});

// PUT /api/admin/razorpay/plan-prices  { table, planId, currency, price }  (empty price = remove)
// Price of a plan in a non-base currency. The base currency price is the plan's own price.
router.put('/razorpay/plan-prices', async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        const { table, planId, price } = req.body;
        if (!PLAN_TABLES.includes(table)) return res.status(400).json({ error: 'table must be plans or hosting_plans' });
        const enabled = await getEnabledCurrencies(true);
        const base = enabled[0];
        const currency = parseCurrency(req.body.currency, SUPPORTED_CURRENCIES.filter((c) => c !== base));
        if (!currency) return res.status(400).json({ error: `Set the ${base} price on the plan itself; other prices must be in ${SUPPORTED_CURRENCIES.filter((c) => c !== base).join(', ')}` });
        if (!(await loadSellablePlan(table, planId))) return res.status(404).json({ error: 'Plan not found' });

        const remove = price === null || price === undefined || String(price).trim() === '';
        const amount = Number(price);
        if (!remove && (!Number.isFinite(amount) || amount <= 0)) return res.status(400).json({ error: 'price must be a positive number' });
        if (remove && enabled.includes(currency)) {
            return res.status(400).json({ error: `${currency} is switched on for customers — switch it off before removing a ${currency} price` });
        }
        await setPlanPrice(table, Number(planId), currency, remove ? null : Math.round(amount * 100) / 100);
        res.json({ message: 'Price saved' });
    } catch (error) {
        console.error('Plan price save error:', error);
        res.status(500).json({ error: 'Failed to save price' });
    }
});

// PUT /api/admin/billing-currencies  { currencies: ['INR','GBP'] }
// Extra currencies offered to customers on top of the base currency. A currency
// can only be switched on once every active plan has a price and a Razorpay
// plan (current mode) in it — otherwise customers would see plans they can't buy.
router.put('/billing-currencies', async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();
        await ensureHostingTables();
        const config = await getRazorpayConfig(true);
        const base = (await getEnabledCurrencies(true))[0];
        const wanted: string[] = Array.from(new Set((Array.isArray(req.body?.currencies) ? req.body.currencies : [])
            .map((c: any) => String(c).toUpperCase())));
        const invalid = wanted.filter((c) => !SUPPORTED_CURRENCIES.includes(c));
        if (invalid.length > 0) return res.status(400).json({ error: `Unsupported currency: ${invalid.join(', ')}` });
        const extras = wanted.filter((c) => c !== base);

        const missing: string[] = [];
        for (const currency of extras) {
            for (const table of PLAN_TABLES) {
                const filter = sellableFilter(table);
                const plans: any = await query(`SELECT * FROM ${table} ${filter ? `${filter} AND` : 'WHERE'} is_active = TRUE`);
                for (const p of plans) {
                    const label = `${table === 'hosting_plans' ? 'Hosting ' : ''}${p.name} (${p.billing_period})`;
                    if (!(await localizePlan(table, p, currency))) { missing.push(`${currency} price for ${label}`); continue; }
                    const mapped: any = await query(
                        'SELECT id FROM razorpay_plan_mappings WHERE mode = ? AND plan_table = ? AND local_plan_id = ? AND currency = ?',
                        [config.mode, table, p.id, currency]
                    );
                    if (mapped.length === 0) missing.push(`${currency} Razorpay ${config.mode} plan for ${label}`);
                }
            }
        }
        if (missing.length > 0) {
            return res.status(400).json({ error: `Cannot switch on yet — missing: ${missing.slice(0, 6).join('; ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}` });
        }

        await saveExtraCurrencies(extras);
        res.json({ message: 'Currencies saved', enabled_currencies: [base, ...extras] });
    } catch (error) {
        console.error('Billing currencies save error:', error);
        res.status(500).json({ error: 'Failed to save currencies' });
    }
});

// POST /api/admin/razorpay/plan-mappings/verify — fetch each mapped plan (current
// mode) from Razorpay and compare amount, currency and billing period.
router.post('/razorpay/plan-mappings/verify', async (req: AuthRequest, res: Response) => {
    try {
        const { client, config } = await getRazorpayClient();
        await ensurePaymentTables();
        const mappings: any = await query('SELECT plan_table, local_plan_id, currency, razorpay_plan_id FROM razorpay_plan_mappings WHERE mode = ?', [config.mode]);
        const results: any[] = [];
        for (const m of mappings) {
            const rows: any = await query(`SELECT * FROM ${m.plan_table} WHERE id = ?`, [m.local_plan_id]);
            if (!rows?.[0]) { results.push({ ...m, ok: false, problems: ['Cataseek plan no longer exists'] }); continue; }
            const plan = await localizePlan(m.plan_table, rows[0], m.currency);
            const info = { ...m, name: rows[0].name, billing_period: rows[0].billing_period };
            if (!plan) { results.push({ ...info, ok: false, problems: [`No ${m.currency} price is set for this plan`] }); continue; }
            try {
                const rzpPlan: any = await client.plans.fetch(m.razorpay_plan_id);
                const problems = comparePlan(rzpPlan, plan, m.currency);
                results.push({ ...info, razorpay_name: rzpPlan?.item?.name, ok: problems.length === 0, problems });
            } catch (e: any) {
                results.push({ ...info, ok: false, problems: [e?.error?.description || e?.message || 'Fetch failed'] });
            }
        }
        res.json({ mode: config.mode, results });
    } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Verification failed' });
    }
});

// POST /api/admin/razorpay/plan-mappings/create  { table, planId, currency } — explicit,
// admin-triggered creation of a Razorpay plan (current mode) for an unmapped
// Cataseek plan + currency.
router.post('/razorpay/plan-mappings/create', async (req: AuthRequest, res: Response) => {
    try {
        const { table, planId } = req.body;
        if (!PLAN_TABLES.includes(table)) return res.status(400).json({ error: 'table must be plans or hosting_plans' });
        await ensurePaymentTables();
        const base = (await getEnabledCurrencies())[0];
        const currency = parseCurrency(req.body.currency || base, [base, ...SUPPORTED_CURRENCIES]);
        if (!currency) return res.status(400).json({ error: 'Unsupported currency' });
        const row = await loadSellablePlan(table, planId);
        if (!row) return res.status(404).json({ error: 'Plan not found' });
        const plan = await localizePlan(table, row, currency);
        if (!plan) return res.status(400).json({ error: `Set the ${currency} price for this plan first` });
        const id = await createAndMapRazorpayPlan(plan, table);
        res.json({ message: `Created and mapped Razorpay plan ${id}`, razorpay_plan_id: id });
    } catch (error: any) {
        if (error instanceof PlanMappingError) return res.status(400).json({ error: error.message });
        res.status(400).json({ error: error?.error?.description || error?.message || 'Failed to create Razorpay plan' });
    }
});

// ─── GET /api/admin/orders ───────────────────────────────────────────────────
// All payment orders across tenants, with filters + revenue summary
router.get('/orders', async (req: AuthRequest, res: Response) => {
    try {
        await ensurePaymentTables();

        const search = (req.query.search as string) || '';
        const status = (req.query.status as string) || '';
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const offset = (page - 1) * limit;

        let where = '1=1';
        const params: any[] = [];

        if (search) {
            where += ` AND (t.store_name LIKE ? OR t.email LIKE ? OR o.razorpay_payment_id LIKE ? OR o.razorpay_subscription_id LIKE ? OR o.plan_name LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (status) {
            where += ' AND o.status = ?';
            params.push(status);
        }

        const orders: any = await query(
            `SELECT o.*, t.store_name, t.email AS tenant_email
             FROM orders o
             JOIN tenants t ON o.tenant_id = t.id
             WHERE ${where}
             ORDER BY o.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const countResult: any = await query(
            `SELECT COUNT(*) AS total FROM orders o JOIN tenants t ON o.tenant_id = t.id WHERE ${where}`,
            params
        );

        const [summary]: any = await query(`
            SELECT
                COUNT(*) AS total_orders,
                SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) AS total_revenue,
                SUM(CASE WHEN status = 'captured' AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN amount ELSE 0 END) AS revenue_this_month,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
            FROM orders
        `);

        // Money is never added up across currencies
        const revenue: any = await query(`
            SELECT currency,
                SUM(amount) AS total_revenue,
                SUM(CASE WHEN created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN amount ELSE 0 END) AS revenue_this_month
            FROM orders WHERE status = 'captured'
            GROUP BY currency ORDER BY currency
        `);

        res.json({
            orders,
            summary: { ...(summary[0] ?? summary), revenue_by_currency: revenue },
            pagination: {
                total: countResult[0].total,
                page,
                limit,
                pages: Math.ceil(countResult[0].total / limit),
            },
        });
    } catch (error) {
        console.error('Admin orders list error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// ─── Platform modules (plugin packages) ──────────────────────────────────────
// One downloadable zip per e-commerce platform; a new upload replaces the old one.

const moduleUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, MODULES_DIR),
        // Text fields are appended before the file on the client, so req.body.platform
        // is already parsed here; fall back to a generic name just in case.
        filename: (req, _file, cb) => {
            const platform = String((req.body as any)?.platform || 'module').replace(/[^a-z0-9_-]/gi, '');
            cb(null, `${platform || 'module'}-${Date.now()}.zip`);
        },
    }),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.zip')) {
            return cb(new Error('Only .zip files are allowed'));
        }
        cb(null, true);
    },
});

// GET /api/admin/modules — all packages incl. inactive, with download counts
router.get('/modules', async (req: AuthRequest, res: Response) => {
    try {
        const modules: any = await query(`
            SELECT id, platform, name, version, description, original_name, file_size,
                   download_count, is_active, created_at, updated_at
            FROM platform_modules ORDER BY platform
        `);
        res.json({ modules });
    } catch (error) {
        console.error('Admin list modules error:', error);
        res.status(500).json({ error: 'Failed to fetch modules' });
    }
});

// POST /api/admin/modules — multipart upload (fields: platform, name, version, description, file)
router.post('/modules', (req: AuthRequest, res: Response) => {
    moduleUpload.single('file')(req, res, async (err: any) => {
        if (err) {
            return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        const file = (req as any).file as Express.Multer.File | undefined;
        try {
            const platform = String(req.body.platform || '').trim().toLowerCase();
            const name = String(req.body.name || '').trim();
            const version = String(req.body.version || '1.0.0').trim();
            const description = String(req.body.description || '').trim() || null;

            if (!file) return res.status(400).json({ error: 'Module zip file is required' });
            if (!platform || !name) {
                removeModuleFile(file.filename);
                return res.status(400).json({ error: 'Platform and name are required' });
            }

            const existing: any = await query('SELECT id, filename FROM platform_modules WHERE platform = ?', [platform]);
            if (existing && existing.length > 0) {
                removeModuleFile(existing[0].filename);
                await query(
                    `UPDATE platform_modules
                     SET name = ?, version = ?, description = ?, filename = ?, original_name = ?, file_size = ?, is_active = TRUE
                     WHERE id = ?`,
                    [name, version, description, file.filename, file.originalname, file.size, existing[0].id]
                );
                return res.json({ message: `Module for ${platform} replaced`, id: existing[0].id });
            }

            const result: any = await query(
                `INSERT INTO platform_modules (platform, name, version, description, filename, original_name, file_size)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [platform, name, version, description, file.filename, file.originalname, file.size]
            );
            res.status(201).json({ message: 'Module uploaded', id: result.insertId });
        } catch (error) {
            if (file) removeModuleFile(file.filename);
            console.error('Admin upload module error:', error);
            res.status(500).json({ error: 'Failed to upload module' });
        }
    });
});

// PATCH /api/admin/modules/:id — toggle visibility on the merchant Plugins page
router.patch('/modules/:id', async (req: AuthRequest, res: Response) => {
    try {
        await query('UPDATE platform_modules SET is_active = ? WHERE id = ?', [req.body.is_active ? 1 : 0, req.params.id]);
        res.json({ message: 'Module updated' });
    } catch (error) {
        console.error('Admin update module error:', error);
        res.status(500).json({ error: 'Failed to update module' });
    }
});

// DELETE /api/admin/modules/:id — remove the package and its file
router.delete('/modules/:id', async (req: AuthRequest, res: Response) => {
    try {
        const rows: any = await query('SELECT filename FROM platform_modules WHERE id = ?', [req.params.id]);
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Module not found' });

        removeModuleFile(rows[0].filename);
        await query('DELETE FROM platform_modules WHERE id = ?', [req.params.id]);
        res.json({ message: 'Module deleted' });
    } catch (error) {
        console.error('Admin delete module error:', error);
        res.status(500).json({ error: 'Failed to delete module' });
    }
});

export default router;
