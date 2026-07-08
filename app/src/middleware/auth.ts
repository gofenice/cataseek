import { Request, Response, NextFunction } from 'express';
import { verifyToken, comparePassword } from '../utils/auth';
import { query } from '../config/database';

export interface AuthRequest extends Request {
  tenant?: any;
  user?: any;
}

// ─── In-Memory TTL Cache ──────────────────────────────────────────────────────
// Eliminates repeated MySQL queries on every search request.
// Saves ~100–150ms per request by avoiding serial DB round-trips.
interface CacheEntry<T> { value: T; expiresAt: number; }

function createCache<T>() {
  const store = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
      return entry.value;
    },
    set(key: string, value: T, ttlMs: number) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key: string) { store.delete(key); },
  };
}

const tenantCache = createCache<any>();   // keyed by api_key,   TTL 5 min
const planCache = createCache<any>();   // keyed by tenant_id,  TTL 15 min
const usageCache = createCache<number>(); // keyed by tenant_id, TTL 60 sec

// ─── JWT Authentication ───────────────────────────────────────────────────────
export const authenticateJWT = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const rows: any = await query(
      'SELECT id, store_name, email, plan_id, status, role, meilisearch_index_name, search_enabled, hosting_enabled FROM tenants WHERE id = ?',
      [decoded.tenantId]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'Tenant not found' });
    }

    req.user = rows[0];
    next();
  } catch (error: any) {
    console.error('JWT Authentication error:', error.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// ─── API Key Authentication ───────────────────────────────────────────────────
// Uses in-memory cache so the tenant DB lookup + bcrypt compare only runs
// once every 5 minutes per unique api_key, not on every search request.
export const authenticateApiKey = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    const apiPassword = req.headers['x-api-password'] as string;

    if (!apiKey || !apiPassword) {
      return res.status(401).json({ error: 'API key and password required' });
    }

    // --- Cache check ---
    let tenant = tenantCache.get(apiKey);
    if (!tenant) {
      const rows: any = await query(
        'SELECT id, store_name, store_domain, email, plan_id, status, api_password_hash, meilisearch_index_name, search_enabled FROM tenants WHERE api_key = ?',
        [apiKey]
      );
      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const t = rows[0];

      // Verify password before caching
      const isValidPassword = await comparePassword(apiPassword, t.api_password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid API password' });
      }

      // Store without password hash for security
      tenant = { ...t };
      delete tenant.api_password_hash;
      tenantCache.set(apiKey, tenant, 5 * 60 * 1000); // 5 minutes
    }

    // Domain auto-registration on password-authenticated calls (sync, delete, etc.)
    // The tenant has proven identity with API key + password, so we trust the domain
    // they are calling from and auto-register it if it's new.
    // Security guard: still reject if the domain is already claimed by a DIFFERENT tenant.
    const requestDomain = req.headers['x-store-domain'] as string;

    if (requestDomain) {
      const normalizeDomain = (d: string) =>
        d ? d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '') : '';
      const incomingDomain = normalizeDomain(requestDomain);
      const isLocalhost = incomingDomain.includes('localhost') || incomingDomain.includes('127.0.0.1');
      if (!isLocalhost && incomingDomain) {
        const conflict: any = await query(
          'SELECT tenant_id FROM tenant_domains WHERE domain = ?',
          [incomingDomain]
        );
        if (conflict && conflict.length > 0 && conflict[0].tenant_id !== tenant.id) {
          return res.status(401).json({
            error: `Authentication failed: Domain "${incomingDomain}" is registered to a different account`
          });
        }
        // Auto-register new domain — first sync from this store adds it to the allowlist
        await query(
          `INSERT INTO tenant_domains (tenant_id, domain, label)
           VALUES (?, ?, 'Auto-registered')
           ON DUPLICATE KEY UPDATE label = label`,
          [tenant.id, incomingDomain]
        );
      }
    }

    if (tenant.status !== 'active' && tenant.status !== 'trial') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    console.error('API Key authentication error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// ─── Public Search Authentication ─────────────────────────────────────────────
// API key only, no password. Also uses tenant cache.
export const authenticatePublicSearch = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    // --- Cache check (5 min TTL) ---
    let tenant = tenantCache.get(apiKey);
    if (!tenant) {
      const rows: any = await query(
        'SELECT id, store_name, store_domain, status, meilisearch_index_name, search_enabled FROM tenants WHERE api_key = ?',
        [apiKey]
      );
      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      tenant = rows[0];
      tenantCache.set(apiKey, tenant, 5 * 60 * 1000);
    }

    // Domain auto-registration on password-authenticated calls (sync, delete, etc.)
    // The tenant has proven identity with API key + password, so we trust the domain
    // they are calling from and auto-register it if it's new.
    // Security guard: still reject if the domain is already claimed by a DIFFERENT tenant.    
    const requestDomain = req.headers['x-store-domain'] as string;
    const normalizeDomain = (d: string) =>
      d ? d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '') : '';
    const incomingDomain = normalizeDomain(requestDomain);
    const isLocalhost = incomingDomain.includes('localhost') || incomingDomain.includes('127.0.0.1');
    
    if (!requestDomain) {
      return res.status(403).json({ error: 'Domain verification failed: X-Store-Domain header is required' });
    }
    
    if (!isLocalhost) {
      const allowed: any = await query(
        'SELECT id FROM tenant_domains WHERE tenant_id = ? AND domain = ?',
        [tenant.id, incomingDomain]
      );
      if (!allowed || allowed.length === 0) {
        return res.status(403).json({ error: `Domain "${incomingDomain}" is not authorised for this account` });
      }
    }

    if (tenant.status !== 'active' && tenant.status !== 'trial') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    console.error('Public Search auth error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// ─── Plan Limits Check ────────────────────────────────────────────────────────
// Caches subscription (15 min) and monthly usage (60 sec) separately.
// Previously ran 2 DB queries per search; now runs 0 on cache hits.
export const checkPlanLimits = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant?.id || req.user?.id;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Hosting-only accounts: search product is switched off entirely
    const searchEnabled = req.tenant?.search_enabled ?? req.user?.search_enabled;
    if (searchEnabled !== undefined && searchEnabled !== null && !searchEnabled) {
      return res.status(403).json({ error: 'Search service is not enabled for this account' });
    }

    const planKey = `plan:${tenantId}`;
    const usageKey = `usage:${tenantId}`;

    // --- Plan / subscription (15 min cache) ---
    let planData = planCache.get(planKey);
    if (!planData) {
      const subscriptions: any = await query(
        `SELECT s.*, p.max_products, p.max_requests_per_month
         FROM subscriptions s
         JOIN plans p ON s.plan_id = p.id
         WHERE s.tenant_id = ? AND s.status = 'active'
         ORDER BY s.current_period_end DESC LIMIT 1`,
        [tenantId]
      );

      if (!subscriptions || subscriptions.length === 0) {
        // Trial fallback
        const tenant: any = await query(
          'SELECT status, trial_ends_at FROM tenants WHERE id = ?',
          [tenantId]
        );
        if (tenant[0]?.status === 'trial' && new Date(tenant[0].trial_ends_at) > new Date()) {
          planData = { max_products: 100, max_requests_per_month: 1000, isTrial: true };
          planCache.set(planKey, planData, 15 * 60 * 1000);
          req.tenant = { ...req.tenant, maxProducts: 100, maxRequests: 1000 };
          return next();
        }
        return res.status(403).json({ error: 'No active subscription' });
      }

      planData = subscriptions[0];
      planCache.set(planKey, planData, 15 * 60 * 1000);
    }

    // --- Monthly usage (60 sec cache — eventually consistent for rate-limiting) ---
    let totalRequests = usageCache.get(usageKey);
    if (totalRequests === null) {
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const usage: any = await query(
        `SELECT SUM(request_count) as total FROM api_usage 
         WHERE tenant_id = ? AND date >= ? 
           AND endpoint IN ('/products/search', '/products/public/search')`,
        [tenantId, firstDay.toISOString().split('T')[0]]
      );
      totalRequests = Number(usage[0]?.total || 0);
      usageCache.set(usageKey, totalRequests, 60 * 1000); // 60 seconds
    }

    if (totalRequests >= planData.max_requests_per_month) {
      return res.status(429).json({ error: 'Monthly request limit exceeded' });
    }

    req.tenant = {
      ...req.tenant,
      maxProducts: planData.max_products,
      maxRequests: planData.max_requests_per_month,
      currentRequests: totalRequests,
    };

    next();
  } catch (error) {
    console.error('Plan limits check error:', error);
    return res.status(500).json({ error: 'Failed to check plan limits' });
  }
};

// ─── Admin Guard ──────────────────────────────────────────────────────────────
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};