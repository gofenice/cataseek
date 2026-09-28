import { Request, Response, NextFunction } from 'express';
import { verifyToken, comparePassword } from '../utils/auth';
import { query, isTransientDbError } from '../config/database';

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

// Call this whenever a tenant's profile (store_domain, status) is updated so the
// cached tenant object is evicted and reloaded fresh on the next API request.
export const invalidateTenantApiCache = (apiKey: string) => {
  tenantCache.delete(apiKey);
};

// Call when a tenant's subscription changes (activation, cancellation, suspension)
// so search limits are re-read on the next request instead of after the 15 min TTL.
export const invalidateTenantPlanCache = (tenantId: number) => {
  planCache.delete(`plan:${tenantId}`);
};

// A subscribed trial user's first charge is scheduled for trial_ends_at; keep the
// trial running for a short grace window while Razorpay processes that charge.
const TRIAL_FIRST_CHARGE_GRACE_HOURS = 24;


/**
 * A failed database call is NOT an authentication failure.
 *
 * These handlers used to return 401 for anything thrown inside the try block —
 * and the only thing that throws is the DB query. A dropped pooled connection
 * therefore looked identical to a bad token, and the dashboard's 401 handling
 * wiped the stored token and logged the user out mid-session. Infrastructure
 * failures now surface as 503 so the client can retry with its session intact.
 */
const failAuth = (res: Response, error: any, context: string) => {
  if (isTransientDbError(error)) {
    console.error(`${context}: transient database error, returning 503:`, error.code || error.message);
    return res.status(503).json({
      error: 'Service temporarily unavailable, please retry',
      retryable: true,
    });
  }
  console.error(`${context}:`, error?.message ?? error);
  return res.status(500).json({ error: 'Authentication check failed', retryable: true });
};

/**
 * Marks a 401 that genuinely means "this session is over".
 *
 * The dashboard signs the user out when it sees this code, and ONLY when it
 * sees it. Without that distinction any 401 from any endpoint ended the
 * session — which is how /products/stats, an endpoint the dashboard cannot
 * authenticate against, was logging people out just for hovering the sidebar.
 */
export const SESSION_INVALID = 'session_invalid';

// ─── JWT Authentication ───────────────────────────────────────────────────────
export const authenticateJWT = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided', code: SESSION_INVALID });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token', code: SESSION_INVALID });
    }

    const rows: any = await query(
      'SELECT id, store_name, email, plan_id, status, role, meilisearch_index_name, search_enabled, hosting_enabled, api_key FROM tenants WHERE id = ?',
      [decoded.tenantId]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'Tenant not found', code: SESSION_INVALID });
    }

    req.user = rows[0];
    next();
  } catch (error: any) {
    return failAuth(res, error, 'JWT authentication');
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

    // Strict Domain Verification: Requesting store domain must match the tenant's primary domain (store_domain)
    // or an authorized domain in tenant_domains for this tenant ID.
    const requestDomain = req.headers['x-store-domain'] as string;
    const normalizeDomain = (d: string) => {
      if (!d) return '';
      let clean = d.toLowerCase().trim();
      clean = clean.replace(/^https?:\/\//, '').replace(/^www\./, '');
      return clean.split('/')[0].split('?')[0].split('#')[0];
    };
    const incomingDomain = normalizeDomain(requestDomain);
    const primaryDomain = normalizeDomain(tenant.store_domain);
    const isLocalhost = incomingDomain.includes('localhost') || incomingDomain.includes('127.0.0.1');

    if (!requestDomain) {
      return res.status(403).json({ error: 'Domain verification failed: X-Store-Domain header is required' });
    }

    if (!isLocalhost && incomingDomain && incomingDomain !== primaryDomain) {
      const allowed: any = await query(
        'SELECT id FROM tenant_domains WHERE tenant_id = ? AND domain = ?',
        [tenant.id, incomingDomain]
      );
      if (!allowed || allowed.length === 0) {
        return res.status(403).json({
          error: `Authentication failed: Domain "${incomingDomain}" is not authorized for this account`
        });
      }
    }

    if (tenant.status !== 'active' && tenant.status !== 'trial') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return failAuth(res, error, 'API key authentication');
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
    const normalizeDomain = (d: string) => {
      if (!d) return '';
      let clean = d.toLowerCase().trim();
      clean = clean.replace(/^https?:\/\//, '').replace(/^www\./, '');
      return clean.split('/')[0].split('?')[0].split('#')[0];
    };
    const incomingDomain = normalizeDomain(requestDomain);
    const isLocalhost = incomingDomain.includes('localhost') || incomingDomain.includes('127.0.0.1');
    
    if (!requestDomain) {
      return res.status(403).json({ error: 'Domain verification failed: X-Store-Domain header is required' });
    }
    
    const primaryDomain = normalizeDomain(tenant.store_domain);
    if (!isLocalhost && incomingDomain && incomingDomain !== primaryDomain) {
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
    return failAuth(res, error, 'Public search authentication');
  }
};

// ─── Dual Authentication (JWT or API key) ─────────────────────────────────────
/**
 * For endpoints reached by BOTH the merchant dashboard and a storefront plugin.
 *
 * /products/stats is the case that forced this: the dashboard prefetches it when
 * you hover the sidebar, while the PrestaShop module uses it as its "test
 * connection" probe with an API key. It was guarded by authenticateApiKey alone,
 * so every dashboard call returned 401 and the client threw the session away.
 *
 * A Bearer token means the dashboard, so authenticate as JWT; anything else
 * falls through to the API-key path. Both branches leave req.tenant and req.user
 * populated, so handlers can read either without caring which was used.
 */
export const authenticateJwtOrApiKey = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateJWT(req, res, () => {
      req.tenant = req.tenant ?? req.user;
      next();
    });
  }

  return authenticateApiKey(req, res, () => {
    req.user = req.user ?? req.tenant;
    next();
  });
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
           AND NOT (s.cancel_at_period_end = 1 AND s.current_period_end <= NOW())
         ORDER BY s.current_period_end DESC LIMIT 1`,
        [tenantId]
      );

      if (!subscriptions || subscriptions.length === 0) {
        // Trial fallback
        const tenant: any = await query(
          `SELECT t.status, t.trial_ends_at,
                  EXISTS (SELECT 1 FROM subscriptions s
                          WHERE s.tenant_id = t.id AND s.status = 'trialing'
                            AND s.starts_at > DATE_SUB(NOW(), INTERVAL ${TRIAL_FIRST_CHARGE_GRACE_HOURS} HOUR)) AS awaiting_first_charge
           FROM tenants t WHERE t.id = ?`,
          [tenantId]
        );
        const trialActive = tenant[0]?.status === 'trial'
          && (new Date(tenant[0].trial_ends_at) > new Date() || !!tenant[0].awaiting_first_charge);
        if (trialActive) {
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