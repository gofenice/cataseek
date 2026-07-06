import express, { Response } from 'express';
import { query } from '../config/database';
import { authenticateJWT, requireAdmin, AuthRequest } from '../middleware/auth';
import { deleteTenantIndex } from '../config/meilisearch';
import { getRazorpayConfig, saveRazorpayConfig, maskSecret, getCompanyConfig, saveCompanyConfig } from '../services/payment-settings.service';
import { getRazorpayClient, ensurePaymentTables } from '../services/razorpay.service';
import { ensureHostingTables } from '../services/hosting.service';

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
        const plans: any = await query('SELECT * FROM plans ORDER BY price ASC');
        res.json({ plans });
    } catch (error) {
        console.error('Admin plans list error:', error);
        res.status(500).json({ error: 'Failed to fetch plans' });
    }
});

// ─── POST /api/admin/plans ────────────────────────────────────────────────────
router.post('/plans', async (req: AuthRequest, res: Response) => {
    try {
        const { name, description, price, billing_period, max_products, max_requests_per_month, features } = req.body;
        if (!name || price == null || !max_requests_per_month) {
            return res.status(400).json({ error: 'name, price, and max_requests_per_month are required' });
        }
        const result: any = await query(
            `INSERT INTO plans (name, description, price, billing_period, max_products, max_requests_per_month, features, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [name, description || '', price, billing_period || 'monthly', max_products || 0, max_requests_per_month, JSON.stringify(features || [])]
        );
        res.status(201).json({ message: 'Plan created', id: result.insertId });
    } catch (error) {
        console.error('Admin plan create error:', error);
        res.status(500).json({ error: 'Failed to create plan' });
    }
});

// ─── PATCH /api/admin/plans/:id ───────────────────────────────────────────────
router.patch('/plans/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { name, description, price, billing_period, max_products, max_requests_per_month, features, is_active } = req.body;

        const allowed: Record<string, any> = {};
        if (name !== undefined) allowed.name = name;
        if (description !== undefined) allowed.description = description;
        if (price !== undefined) allowed.price = price;
        if (billing_period !== undefined) allowed.billing_period = billing_period;
        if (max_products !== undefined) allowed.max_products = max_products;
        if (max_requests_per_month !== undefined) allowed.max_requests_per_month = max_requests_per_month;
        if (features !== undefined) allowed.features = JSON.stringify(features);
        if (is_active !== undefined) allowed.is_active = is_active ? 1 : 0;

        if (Object.keys(allowed).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const setClauses = Object.keys(allowed).map(k => `${k} = ?`).join(', ');
        await query(`UPDATE plans SET ${setClauses}, updated_at = NOW() WHERE id = ?`, [...Object.values(allowed), id]);
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
        await query('UPDATE plans SET is_active = FALSE WHERE id = ?', [id]);
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
        const plans: any = await query('SELECT * FROM hosting_plans ORDER BY price ASC');

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

// POST /api/admin/hosting-plans
router.post('/hosting-plans', async (req: AuthRequest, res: Response) => {
    try {
        await ensureHostingTables();
        const { name, price, storage_gb, ram_gb, bandwidth, billing_period } = req.body;

        if (!name || price == null || storage_gb == null || ram_gb == null) {
            return res.status(400).json({ error: 'name, price, storage_gb, and ram_gb are required' });
        }

        const result: any = await query(
            `INSERT INTO hosting_plans (name, price, storage_gb, ram_gb, bandwidth, billing_period, is_active)
             VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
            [name, price, storage_gb, ram_gb, bandwidth || 'Unlimited', billing_period === 'yearly' ? 'yearly' : 'monthly']
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
        const { name, price, storage_gb, ram_gb, bandwidth, billing_period, is_active } = req.body;

        const allowed: Record<string, any> = {};
        if (name !== undefined) allowed.name = name;
        if (price !== undefined) allowed.price = price;
        if (storage_gb !== undefined) allowed.storage_gb = storage_gb;
        if (ram_gb !== undefined) allowed.ram_gb = ram_gb;
        if (bandwidth !== undefined) allowed.bandwidth = bandwidth;
        if (billing_period !== undefined) allowed.billing_period = billing_period === 'yearly' ? 'yearly' : 'monthly';
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
        await query('UPDATE hosting_plans SET is_active = FALSE WHERE id = ?', [req.params.id]);
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

        res.json({
            orders,
            summary: summary[0] ?? summary,
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

export default router;
