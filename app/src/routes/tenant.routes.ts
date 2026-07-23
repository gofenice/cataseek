import express from 'express';
import { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { createTenantIndex, searchProducts, deleteTenantIndex } from '../config/meilisearch';
import { getRazorpayClient } from '../services/razorpay.service';
import { hashPassword, comparePassword, generateToken, generateApiKey, generateIndexName } from '../utils/auth';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { sendRegistrationWelcomeEmail, sendPasswordResetEmail, sendVerificationEmail } from '../services/mailer.service';
import { generateToken as generateAccountToken, hashToken, ensureAccountColumns } from '../services/account.service';

const router = express.Router();

// ─── Rate limiters (brute-force protection) ───────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this IP. Please try again later.' },
});

const passwordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const APP_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000';

// Search Preview Proxy (for Dashboard)
router.post('/preview-search', authenticateJWT, async (req: AuthRequest, res: Response) => {
  console.log('[Preview] Request received');
  try {
    const { query, filters, options } = req.body;
    const indexName = req.user.meilisearch_index_name;

    console.log(`[Preview] Searching index: ${indexName}, Query: ${query}`);

    if (!indexName) {
      console.error('[Preview] No index name found for user');
      return res.status(400).json({ error: 'Search index not configured' });
    }

    const results = await searchProducts(
      indexName,
      query || '',
      filters,
      options
    );

    console.log(`[Preview] Search complete. Hits: ${results.hits?.length}`);

    res.json(results);
  } catch (error) {
    console.error('Preview search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Register new tenant
router.post(
  '/register',
  registerLimiter,
  [
    body('storeName').trim().notEmpty().withMessage('Store name is required'),
    body('storeDomain').trim().isLength({ min: 3 }).withMessage('Store domain must be at least 3 characters'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('termsAccepted').equals('true').withMessage('You must accept the Terms & Conditions to create an account'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { storeName, storeDomain, email, password } = req.body;

      // Check if email or domain already exists
      const existing: any = await query(
        'SELECT id FROM tenants WHERE email = ? OR store_domain = ?',
        [email, storeDomain]
      );

      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'Email or domain already registered' });
      }

      const passwordHash = await hashPassword(password);
      const apiKey = generateApiKey();
      // Use the same password as the default API password for convenience in trial
      const apiPasswordHash = await hashPassword(password);

      // Calculate trial end date (14 days from now)
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      // Email verification token (raw goes in the email link, hash in the DB)
      await ensureAccountColumns();
      const verify = generateAccountToken();

      // Insert tenant with default Starter plan (id: 1) and API keys
      const result: any = await query(
        `INSERT INTO tenants (
          store_name,
          store_domain,
          email,
          password_hash,
          plan_id,
          api_key,
          api_password_hash,
          status,
          trial_ends_at,
          verify_token_hash,
          terms_accepted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'trial', ?, ?, NOW())`,
        [
          storeName,
          storeDomain.toLowerCase(),
          email.toLowerCase(),
          passwordHash,
          1, // Starter Plan ID
          apiKey,
          apiPasswordHash,
          trialEndsAt,
          verify.hash
        ]
      );

      const tenantId = result.insertId;

      // Generate index name and update tenant
      const indexName = generateIndexName(tenantId);
      await query(
        'UPDATE tenants SET meilisearch_index_name = ? WHERE id = ?',
        [indexName, tenantId]
      );

      // Create Meilisearch index for this tenant
      await createTenantIndex(indexName);

      // Create tenant's product table
      await query(`
        CREATE TABLE IF NOT EXISTS products_${tenantId} (
          id VARCHAR(50) PRIMARY KEY,
          external_id VARCHAR(100) NOT NULL,
          name VARCHAR(500) NOT NULL,
          description TEXT,
          price DECIMAL(10, 2),
          compare_price DECIMAL(10, 2),
          quantity INT DEFAULT 0,
          sku VARCHAR(100),
          categories JSON,
          attributes JSON,
          images JSON,
          language VARCHAR(10) DEFAULT 'en',
          store_id VARCHAR(50),
          status ENUM('active', 'inactive', 'draft') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_external_id (external_id),
          INDEX idx_status (status),
          INDEX idx_language (language),
          INDEX idx_store_id (store_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // Generate JWT token
      const token = generateToken({ tenantId, apiKey });

      // Send welcome + verification emails (fire-and-forget)
      sendRegistrationWelcomeEmail(email, storeName, trialEndsAt)
        .catch((e) => console.error('Welcome email error:', e));
      const verifyUrl = `${APP_URL()}/verify-email?token=${verify.raw}&email=${encodeURIComponent(email.toLowerCase())}`;
      sendVerificationEmail(email, storeName, verifyUrl)
        .catch((e) => console.error('Verification email error:', e));

      res.status(201).json({
        message: 'Registration successful',
        token,
        tenant: {
          id: tenantId,
          storeName,
          storeDomain,
          email,
          status: 'trial',
          trialEndsAt
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// ─── Forgot password ───────────────────────────────────────────────────────────
// Always responds 200 so attackers can't probe which emails exist.
router.post('/forgot-password', passwordLimiter, async (req: Request, res: Response) => {
  try {
    await ensureAccountColumns();
    const email = String(req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const rows: any = await query('SELECT id, store_name FROM tenants WHERE email = ?', [email]);
    if (rows && rows.length > 0) {
      const token = generateAccountToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await query(
        'UPDATE tenants SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?',
        [token.hash, expires, rows[0].id]
      );
      const resetUrl = `${APP_URL()}/reset-password?token=${token.raw}&email=${encodeURIComponent(email)}`;
      sendPasswordResetEmail(email, rows[0].store_name, resetUrl)
        .catch((e) => console.error('Reset email error:', e));
    }

    res.json({ message: 'If that email is registered, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ─── Reset password ────────────────────────────────────────────────────────────
router.post('/reset-password', passwordLimiter, async (req: Request, res: Response) => {
  try {
    await ensureAccountColumns();
    const email = String(req.body.email || '').toLowerCase().trim();
    const token = String(req.body.token || '');
    const newPassword = String(req.body.newPassword || '');

    if (!email || !token) return res.status(400).json({ error: 'Invalid reset link' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const rows: any = await query(
      'SELECT id, reset_token_hash, reset_token_expires FROM tenants WHERE email = ?',
      [email]
    );
    if (!rows || rows.length === 0 || !rows[0].reset_token_hash) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    const t = rows[0];
    if (hashToken(token) !== t.reset_token_hash || !t.reset_token_expires || new Date(t.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const newHash = await hashPassword(newPassword);
    await query(
      'UPDATE tenants SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?',
      [newHash, t.id]
    );

    res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ─── Verify email ──────────────────────────────────────────────────────────────
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    await ensureAccountColumns();
    const email = String(req.body.email || '').toLowerCase().trim();
    const token = String(req.body.token || '');
    if (!email || !token) return res.status(400).json({ error: 'Invalid verification link' });

    const rows: any = await query(
      'SELECT id, email_verified, verify_token_hash FROM tenants WHERE email = ?',
      [email]
    );
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'Invalid verification link' });

    if (rows[0].email_verified) return res.json({ message: 'Email already verified. You are all set!' });

    if (!rows[0].verify_token_hash || hashToken(token) !== rows[0].verify_token_hash) {
      return res.status(400).json({ error: 'Invalid verification link' });
    }

    await query(
      'UPDATE tenants SET email_verified = TRUE, verify_token_hash = NULL WHERE id = ?',
      [rows[0].id]
    );
    res.json({ message: 'Email verified successfully!' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// ─── Resend verification email ─────────────────────────────────────────────────
router.post('/resend-verification', authenticateJWT, passwordLimiter, async (req: AuthRequest, res: Response) => {
  try {
    await ensureAccountColumns();
    const rows: any = await query('SELECT email, store_name, email_verified FROM tenants WHERE id = ?', [req.user.id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    if (rows[0].email_verified) return res.json({ message: 'Email is already verified.' });

    const token = generateAccountToken();
    await query('UPDATE tenants SET verify_token_hash = ? WHERE id = ?', [token.hash, req.user.id]);

    const verifyUrl = `${APP_URL()}/verify-email?token=${token.raw}&email=${encodeURIComponent(rows[0].email)}`;
    await sendVerificationEmail(rows[0].email, rows[0].store_name, verifyUrl);

    res.json({ message: 'Verification email sent. Check your inbox.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// Login tenant
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const rows: any = await query(
      'SELECT id, email, password_hash, store_name, status, api_key, role FROM tenants WHERE email = ?',
      [email.toLowerCase()]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const tenant = rows[0];
    const bcrypt = require('bcryptjs');
    const isValidPassword = await bcrypt.compare(password, tenant.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Host separation: super admins sign in only on the admin host,
    // merchants only elsewhere (no restriction when SUPERADMIN_HOST is unset, e.g. local dev)
    const superAdminHost = process.env.SUPERADMIN_HOST;
    if (superAdminHost) {
      if (tenant.role === 'admin' && req.hostname !== superAdminHost) {
        return res.status(403).json({ error: `Super admin sign-in is only available at https://${superAdminHost}` });
      }
      if (tenant.role !== 'admin' && req.hostname === superAdminHost) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    const token = generateToken({
      tenantId: tenant.id,
      apiKey: tenant.api_key,
      role: tenant.role,
    });

    res.json({
      message: 'Login successful',
      token,
      tenant: {
        id: tenant.id,
        email: tenant.email,
        storeName: tenant.store_name,
        status: tenant.status,
        role: tenant.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get tenant profile
router.get('/profile', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const rows: any = await query(
      `SELECT t.id, t.store_name, t.store_domain, t.email, t.status, t.role, t.trial_ends_at,
              t.api_key, t.meilisearch_index_name, t.created_at,
              t.search_enabled, t.hosting_enabled, t.email_verified,
              p.name as plan_name, p.max_products, p.max_requests_per_month
       FROM tenants t
       LEFT JOIN subscriptions s ON t.id = s.tenant_id AND s.status = 'active'
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE t.id = ?`,
      [req.user.id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({ tenant: rows[0] });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update tenant profile
router.put(
  '/profile',
  authenticateJWT,
  [
    body('storeName').trim().notEmpty().withMessage('Store name is required'),
    body('storeDomain').trim().notEmpty().withMessage('Store domain is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { storeName, storeDomain, email } = req.body;
      const cleanDomain = storeDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase();

      // Check if domain or email is already taken by another tenant
      const existing: any = await query(
        'SELECT id, email, store_domain FROM tenants WHERE (email = ? OR store_domain = ?) AND id != ?',
        [email, cleanDomain, req.user.id]
      );

      if (existing && existing.length > 0) {
        if (existing[0].email === email) {
          return res.status(400).json({ error: 'Email is already registered by another store' });
        }
        return res.status(400).json({ error: 'Store domain is already registered' });
      }

      await query(
        'UPDATE tenants SET store_name = ?, store_domain = ?, email = ? WHERE id = ?',
        [storeName, cleanDomain, email, req.user.id]
      );

      res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

// Change account password
router.put(
  '/password',
  authenticateJWT,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;

      const rows: any = await query('SELECT password_hash FROM tenants WHERE id = ?', [req.user.id]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const valid = await comparePassword(currentPassword, rows[0].password_hash);
      if (!valid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const newHash = await hashPassword(newPassword);
      await query('UPDATE tenants SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

// ─── Self-service account deletion ─────────────────────────────────────────────
// Password-confirmed. Cancels gateway subscriptions, then wipes all tenant data.
router.delete('/account', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password confirmation is required' });

    const rows: any = await query('SELECT password_hash, meilisearch_index_name FROM tenants WHERE id = ?', [req.user.id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Account not found' });

    const valid = await comparePassword(password, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Password is incorrect' });

    const tenantId = req.user.id;

    // 1. Cancel any active subscriptions at the gateway (search + hosting)
    try {
      const activeSubs: any = await query(
        `SELECT razorpay_subscription_id FROM subscriptions WHERE tenant_id = ? AND status = 'active' AND razorpay_subscription_id IS NOT NULL
         UNION
         SELECT razorpay_subscription_id FROM hosting_subscriptions WHERE tenant_id = ? AND status = 'active' AND razorpay_subscription_id IS NOT NULL`,
        [tenantId, tenantId]
      );
      if (activeSubs.length > 0) {
        const { client } = await getRazorpayClient();
        for (const s of activeSubs) {
          try { await client.subscriptions.cancel(s.razorpay_subscription_id, false); } catch (e) { /* may be a hosting table that doesn't exist / already cancelled */ }
        }
      }
    } catch (e) { /* gateway not configured — nothing to cancel */ }

    // 2. Drop the tenant's product table
    try { await query(`DROP TABLE IF EXISTS products_${tenantId}`); } catch (e) { console.warn('Drop products table:', e); }

    // 3. Delete the Meilisearch index
    if (rows[0].meilisearch_index_name) {
      try { await deleteTenantIndex(rows[0].meilisearch_index_name); } catch (e) { console.warn('Delete meili index:', e); }
    }

    // 4. Delete the tenant row — CASCADE wipes subscriptions, invoices, orders, usage, settings
    await query('DELETE FROM tenants WHERE id = ? AND role = ?', [tenantId, 'merchant']);

    console.log(`[Account] Self-service deletion completed for tenant ${tenantId}`);
    res.json({ message: 'Your account and all associated data have been permanently deleted.' });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Generate API key and set API password
router.post(
  '/generate-api-key',
  authenticateJWT,
  [
    body('apiPassword').isLength({ min: 8 }).withMessage('API password must be at least 8 characters')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { apiPassword } = req.body;
      const apiKey = generateApiKey();
      const apiPasswordHash = await hashPassword(apiPassword);

      await query(
        'UPDATE tenants SET api_key = ?, api_password_hash = ? WHERE id = ?',
        [apiKey, apiPasswordHash, req.user.id]
      );

      res.json({
        message: 'API key generated successfully',
        apiKey,
        note: 'Store this API key and password securely. You will need them for plugin/module integration.'
      });
    } catch (error) {
      console.error('API key generation error:', error);
      res.status(500).json({ error: 'Failed to generate API key' });
    }
  }
);

// Regenerate API key
router.post('/regenerate-api-key', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const apiKey = generateApiKey();

    await query(
      'UPDATE tenants SET api_key = ? WHERE id = ?',
      [apiKey, req.user.id]
    );

    res.json({
      message: 'API key regenerated successfully',
      apiKey,
      warning: 'Your old API key is now invalid. Update your plugins/modules with the new key.'
    });
  } catch (error) {
    console.error('API key regeneration error:', error);
    res.status(500).json({ error: 'Failed to regenerate API key' });
  }
});

// Dashboard stats — single endpoint for all Overview data
router.get('/stats', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user.id;
    const indexName = req.user.meilisearch_index_name;

    // Product count from tenant's product table
    let productCount = 0;
    if (indexName) {
      try {
        const countRows: any = await query(`SELECT COUNT(DISTINCT external_id) AS cnt FROM products_${tenantId}`);
        productCount = countRows[0]?.cnt || 0;
      } catch (_) { /* table may not exist yet */ }
    }

    // Current month usage
    const usageRows: any = await query(
      `SELECT COALESCE(SUM(request_count), 0) AS used
       FROM api_usage
       WHERE tenant_id = ? AND date >= DATE_FORMAT(NOW(), '%Y-%m-01')
         AND endpoint IN ('/products/search', '/products/public/search')`,
      [tenantId]
    );
    const searchesThisMonth = Number(usageRows[0]?.used || 0);

    // Active subscription + plan limits
    const subRows: any = await query(
      `SELECT s.current_period_end, s.status,
              p.name AS plan_name, p.max_requests_per_month, p.max_products
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = ? AND s.status = 'active'
       ORDER BY s.current_period_end DESC LIMIT 1`,
      [tenantId]
    );

    const sub = subRows[0] || null;
    const planName = sub?.plan_name || 'Trial';
    const searchLimit = sub?.max_requests_per_month || 1000;
    const productLimit = sub?.max_products || 100;

    // Days until renewal
    let renewsIn: number | null = null;
    if (sub?.current_period_end) {
      const diff = new Date(sub.current_period_end).getTime() - Date.now();
      renewsIn = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }

    // Tenant status (for trial banner)
    const tenantRows: any = await query('SELECT status, trial_ends_at FROM tenants WHERE id = ?', [tenantId]);
    const tenantStatus = tenantRows[0]?.status || 'trial';
    const trialEndsAt = tenantRows[0]?.trial_ends_at || null;

    // 30-day daily usage history for chart
    const historyRows: any = await query(
      `SELECT date, COALESCE(SUM(request_count), 0) AS requests
       FROM api_usage
       WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
         AND endpoint IN ('/products/search', '/products/public/search')
       GROUP BY date
       ORDER BY date ASC`,
      [tenantId]
    );

    res.json({
      productCount,
      productLimit,
      searchesThisMonth,
      searchLimit,
      usagePercent: searchLimit > 0 ? Math.min(100, Math.round((searchesThisMonth / searchLimit) * 100)) : 0,
      planName,
      planStatus: tenantStatus,
      renewsIn,
      trialEndsAt,
      usageHistory: historyRows.map((r: any) => ({
        date: r.date,
        requests: Number(r.requests),
      })),
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/tenants/analytics ──────────────────────────────────────────────
// Returns top searched terms and low-result searches for the tenant's storefront.
// Query params:
//   days               (default 30)  — lookback window
//   limit              (default 15)  — rows per list
//   low_result_threshold (default 3) — avg results below this = "low result"
router.get('/analytics', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user.id;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 15));
    const lowThreshold = parseFloat(req.query.low_result_threshold as string) || 3;

    // ── Ensure table exists (lazy migration) ──────────────────────────────────
    await query(
      `CREATE TABLE IF NOT EXISTS search_analytics (
         id           BIGINT AUTO_INCREMENT PRIMARY KEY,
         tenant_id    INT NOT NULL,
         query        VARCHAR(500) NOT NULL,
         result_count INT NOT NULL DEFAULT 0,
         language     VARCHAR(10)  DEFAULT 'en',
         searched_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_tenant_date  (tenant_id, searched_at),
         INDEX idx_tenant_query (tenant_id, query(100)),
         FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    // ── 90-day retention — lazy prune (fire-and-forget) ──────────────────────
    query(
      `DELETE FROM search_analytics
       WHERE tenant_id = ? AND searched_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [tenantId]
    ).catch(() => { });

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    const fromStr = fromDate.toISOString().split('T')[0];

    // ── Top searches ─────────────────────────────────────────────────────────
    const topSearches: any = await query(
      `SELECT
         query,
         COUNT(*)          AS count,
         AVG(result_count) AS avg_results
       FROM search_analytics
       WHERE tenant_id = ? AND searched_at >= ?
       GROUP BY query
       ORDER BY count DESC
       LIMIT ?`,
      [tenantId, fromStr, limit]
    );

    // ── Low-result searches ───────────────────────────────────────────────────
    // Most-searched terms that consistently returned few/no results.
    // Ordered by search count desc so the most "missed" products float to top.
    const lowResultSearches: any = await query(
      `SELECT
         query,
         COUNT(*)          AS count,
         AVG(result_count) AS avg_results
       FROM search_analytics
       WHERE tenant_id = ? AND searched_at >= ?
       GROUP BY query
       HAVING AVG(result_count) < ?
       ORDER BY count DESC
       LIMIT ?`,
      [tenantId, fromStr, lowThreshold, limit]
    );

    // ── Summary stats ─────────────────────────────────────────────────────────
    const summary: any = await query(
      `SELECT
         COUNT(*)                         AS total_searches,
         COUNT(DISTINCT query)            AS unique_queries,
         SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS zero_result_count
       FROM search_analytics
       WHERE tenant_id = ? AND searched_at >= ?`,
      [tenantId, fromStr]
    );

    const s = summary[0] || {};
    const totalSearches = Number(s.total_searches || 0);
    const uniqueQueries = Number(s.unique_queries || 0);
    const zeroResults = Number(s.zero_result_count || 0);

    res.json({
      topSearches: topSearches.map((r: any) => ({
        query: r.query,
        count: Number(r.count),
        avg_results: parseFloat(Number(r.avg_results).toFixed(1)),
      })),
      lowResultSearches: lowResultSearches.map((r: any) => ({
        query: r.query,
        count: Number(r.count),
        avg_results: parseFloat(Number(r.avg_results).toFixed(1)),
      })),
      summary: {
        totalSearches,
        uniqueQueries,
        zeroResultRate: totalSearches > 0
          ? parseFloat(((zeroResults / totalSearches) * 100).toFixed(1))
          : 0,
      },
      period: {
        days,
        from: fromStr,
        to: new Date().toISOString().split('T')[0],
      },
    });
  } catch (error) {
    console.error('Analytics fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ─── Domain Allowlist Management ─────────────────────────────────────────────
// Tenants can register multiple store domains under one account.
// All registered domains pass the X-Store-Domain verification check.

// GET /api/tenants/domains — list all allowed domains for the logged-in tenant
router.get('/domains', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const rows: any = await query(
      'SELECT id, domain, label, created_at FROM tenant_domains WHERE tenant_id = ? ORDER BY created_at ASC',
      [req.user.id]
    );
    res.json({ domains: rows });
  } catch (error) {
    console.error('Domains fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch domains' });
  }
});

// POST /api/tenants/domains — add a new allowed domain
router.post(
  '/domains',
  authenticateJWT,
  [
    body('domain')
      .trim()
      .notEmpty().withMessage('Domain is required')
      .isLength({ max: 253 }).withMessage('Domain too long')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const rawDomain: string = req.body.domain;
      const label: string = (req.body.label || '').toString().trim().slice(0, 100);

      // Normalize: strip scheme, www, trailing slash, lowercase
      const domain = rawDomain
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/$/, '');

      if (!domain) {
        return res.status(400).json({ error: 'Invalid domain' });
      }

      // Check if domain already belongs to another tenant
      const conflict: any = await query(
        'SELECT tenant_id FROM tenant_domains WHERE domain = ?',
        [domain]
      );
      if (conflict && conflict.length > 0 && conflict[0].tenant_id !== req.user.id) {
        return res.status(409).json({ error: 'Domain is already registered by another account' });
      }

      const result: any = await query(
        `INSERT INTO tenant_domains (tenant_id, domain, label)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE label = VALUES(label)`,
        [req.user.id, domain, label]
      );

      res.status(201).json({
        id: result.insertId || null,
        domain,
        label,
        message: 'Domain added successfully'
      });
    } catch (error) {
      console.error('Domain add error:', error);
      res.status(500).json({ error: 'Failed to add domain' });
    }
  }
);

// DELETE /api/tenants/domains/:id — remove a domain (cannot remove the last one)
router.delete('/domains/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const domainId = parseInt(req.params.id);
    if (!domainId) {
      return res.status(400).json({ error: 'Invalid domain ID' });
    }

    // Verify ownership
    const rows: any = await query(
      'SELECT id FROM tenant_domains WHERE id = ? AND tenant_id = ?',
      [domainId, req.user.id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Prevent deleting the last domain — would lock the tenant out
    const countRows: any = await query(
      'SELECT COUNT(*) AS cnt FROM tenant_domains WHERE tenant_id = ?',
      [req.user.id]
    );
    if (Number(countRows[0]?.cnt || 0) <= 1) {
      return res.status(400).json({
        error: 'Cannot remove your only registered domain. Add another domain first.'
      });
    }

    await query('DELETE FROM tenant_domains WHERE id = ? AND tenant_id = ?', [domainId, req.user.id]);
    res.json({ success: true, message: 'Domain removed' });
  } catch (error) {
    console.error('Domain delete error:', error);
    res.status(500).json({ error: 'Failed to remove domain' });
  }
});

export default router;
