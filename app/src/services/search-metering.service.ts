import crypto from 'crypto';
import { query } from '../config/database';

/**
 * Server-side search metering.
 *
 * Billing used to be decided in the storefront's browser: cataseek-front.js ran a
 * 5s dwell timer and only then sent `count_only: true`, which was the ONLY thing
 * that incremented api_usage. The real search path was never metered at all, so
 * editing DWELL_MS, stubbing fireDwellCount(), or simply never sending the ping
 * made every search free. Nothing here trusts the client any more: the meter runs
 * on the request that actually costs us Meilisearch time.
 *
 * The tricky part is that "one request" is not "one search" — a shopper typing
 * "nike" produces n → ni → nik → nike, and filters/pagination re-query the same
 * term. So requests are collapsed into search SESSIONS, and only the first request
 * of a distinct query root is billable.
 */

// ─── Tunables ─────────────────────────────────────────────────────────────────
const SESSION_IDLE_MS = 10 * 60 * 1000; // drop a session after 10 min of silence
const ROOT_REBILL_MS = 60 * 1000;       // re-bill an unchanged root after 60s of continued use
const MAX_SESSIONS = 50_000;            // hard ceiling on the session map
const FLUSH_INTERVAL_MS = 5_000;        // usage + analytics-text flush cadence
const MIN_BILLABLE_LEN = 3;             // ignore 1–2 char fragments, as before

export const SEARCH_ENDPOINT = '/products/public/search';

// ─── Bot detection ────────────────────────────────────────────────────────────
// Crawlers must not burn a tenant's quota. They still get results — we just don't
// meter them — so nothing about the storefront's SEO behaviour changes.
const BOT_UA = new RegExp(
  [
    'bot', 'crawler', 'spider', 'crawling', 'slurp', 'mediapartners',
    'facebookexternalhit', 'ia_archiver', 'semrush', 'ahrefs', 'mj12', 'dotbot',
    'petalbot', 'bytespider', 'gptbot', 'ccbot', 'claudebot', 'perplexity',
    'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'scrapy',
    'python-requests', 'python-urllib', 'go-http-client', 'axios/', 'node-fetch',
    'curl/', 'wget/', 'libwww-perl', 'okhttp', 'java/', 'httpclient',
  ].join('|'),
  'i'
);

export const isBotRequest = (userAgent: string | undefined): boolean => {
  if (!userAgent || userAgent.trim() === '') return true; // no UA at all — not a real browser
  return BOT_UA.test(userAgent);
};

// ─── Session identity ─────────────────────────────────────────────────────────
/**
 * A client-supplied session id is used when present, falling back to IP+UA.
 *
 * Trusting the client here is safe in the only direction that matters: a forged or
 * rotated session id can only SPLIT a shopper's typing burst into more billable
 * searches, never fewer. Collapsing requires sending the same id AND the same query
 * root, which ROOT_REBILL_MS then re-bills anyway. The IP+UA fallback is coarser —
 * shoppers behind one NAT sharing a browser version land in one session — so the
 * plugin should always send an id.
 */
export const sessionKeyFor = (
  tenantId: number,
  sessionId: string | undefined,
  ip: string | undefined,
  userAgent: string | undefined
): string => {
  const basis = sessionId && sessionId.length <= 128
    ? `s:${sessionId}`
    : `f:${ip || 'noip'}|${userAgent || 'noua'}`;
  return `${tenantId}:${crypto.createHash('sha1').update(basis).digest('base64url')}`;
};

// ─── Session state ────────────────────────────────────────────────────────────
interface SearchSession {
  root: string;          // normalized query text this session was last billed for
  billedAt: number;      // when that root was billed
  lastSeen: number;      // last request in this session
  analyticsId: number | null; // search_analytics row to keep updated as the query grows
  pendingText: string | null; // longest form seen since the row was written
  pendingCount: number;
}

const sessions = new Map<string, SearchSession>();

// tenantId|endpoint|date → increments waiting to be written
const usageBuffer = new Map<string, number>();

export const normalizeQuery = (q: string): string => (q || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Two queries belong to the same typing burst when one is a prefix of the other.
 * That covers forward typing (nik → nike) and backspacing (nike → nik) alike.
 */
const isSameBurst = (a: string, b: string): boolean =>
  a === b || a.startsWith(b) || b.startsWith(a);

const evictIfNeeded = () => {
  if (sessions.size <= MAX_SESSIONS) return;
  // Cheap approximation of LRU: Map preserves insertion order, and every touch
  // re-inserts, so the oldest keys sit at the front.
  const excess = sessions.size - MAX_SESSIONS;
  let dropped = 0;
  for (const key of sessions.keys()) {
    sessions.delete(key);
    if (++dropped >= excess) break;
  }
};

export interface MeterResult {
  billed: boolean;
  reason: 'billed' | 'same-burst' | 'too-short' | 'bot' | 'empty';
}

/**
 * Decide whether this search request is a new billable search, and record it.
 *
 * Writes are buffered — nothing here blocks the response on a DB round trip
 * except the one INSERT that creates an analytics row for a genuinely new search.
 */
export const meterSearch = async (opts: {
  tenantId: number;
  rawQuery: string;
  resultCount: number;
  language?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}): Promise<MeterResult> => {
  const { tenantId, rawQuery, resultCount, language, sessionId, ip, userAgent } = opts;

  if (isBotRequest(userAgent)) return { billed: false, reason: 'bot' };

  const q = normalizeQuery(rawQuery);
  if (!q) return { billed: false, reason: 'empty' };
  if (q.length < MIN_BILLABLE_LEN) return { billed: false, reason: 'too-short' };

  const key = sessionKeyFor(tenantId, sessionId, ip, userAgent);
  const now = Date.now();
  const existing = sessions.get(key);

  // Same typing burst, still inside the re-bill window → not a new search.
  // Filter changes and pagination land here too: they re-send the same query text.
  if (existing && isSameBurst(existing.root, q) && now - existing.billedAt < ROOT_REBILL_MS) {
    sessions.delete(key); // re-insert to refresh LRU position
    sessions.set(key, {
      ...existing,
      lastSeen: now,
      // Keep the longest form so analytics records "nike", not "n"
      root: q.length > existing.root.length ? q : existing.root,
      pendingText: q.length > existing.root.length ? q : existing.pendingText,
      pendingCount: resultCount,
    });
    return { billed: false, reason: 'same-burst' };
  }

  // New billable search.
  bufferUsage(tenantId, SEARCH_ENDPOINT);

  // Insert immediately rather than at flush time: the row must survive a crash,
  // otherwise api_usage and search_analytics drift apart (which is exactly the
  // dashboard discrepancy this replaces).
  let analyticsId: number | null = null;
  try {
    const result: any = await query(
      `INSERT INTO search_analytics (tenant_id, query, result_count, language)
       VALUES (?, ?, ?, ?)`,
      [tenantId, q.slice(0, 500), resultCount, language || 'en']
    );
    analyticsId = result?.insertId ?? null;
  } catch {
    // Analytics must never break search.
  }

  sessions.delete(key);
  sessions.set(key, {
    root: q,
    billedAt: now,
    lastSeen: now,
    analyticsId,
    pendingText: null,
    pendingCount: resultCount,
  });
  evictIfNeeded();

  return { billed: true, reason: 'billed' };
};

// ─── Buffered usage counters ──────────────────────────────────────────────────
const bufferUsage = (tenantId: number, endpoint: string) => {
  const date = new Date().toISOString().split('T')[0];
  const key = `${tenantId}|${endpoint}|${date}`;
  usageBuffer.set(key, (usageBuffer.get(key) || 0) + 1);
};

/**
 * Increments still sitting in the buffer for this tenant this month.
 * checkPlanLimits adds this to its cached DB total so a burst cannot overshoot
 * the plan ceiling by a whole flush window.
 */
export const getBufferedUsage = (tenantId: number): number => {
  const prefix = `${tenantId}|`;
  let total = 0;
  for (const [key, count] of usageBuffer) {
    if (key.startsWith(prefix)) total += count;
  }
  return total;
};

/** Write buffered usage counts and analytics text updates. Safe to call anytime. */
export const flushMetering = async (): Promise<void> => {
  // --- usage counters: one multi-row upsert instead of one statement per search ---
  if (usageBuffer.size > 0) {
    const entries = [...usageBuffer.entries()];
    usageBuffer.clear();
    const values: any[] = [];
    const placeholders = entries.map(([key, count]) => {
      const [tenantId, endpoint, date] = key.split('|');
      values.push(Number(tenantId), endpoint, date, count);
      return '(?, ?, ?, ?)';
    });
    try {
      await query(
        `INSERT INTO api_usage (tenant_id, endpoint, date, request_count)
         VALUES ${placeholders.join(', ')}
         ON DUPLICATE KEY UPDATE request_count = request_count + VALUES(request_count)`,
        values
      );
    } catch (e) {
      // Put them back so a transient DB error doesn't silently lose billing data.
      for (const [key, count] of entries) {
        usageBuffer.set(key, (usageBuffer.get(key) || 0) + count);
      }
      console.error('Usage flush failed, counts retained for next flush:', e);
    }
  }

  // --- analytics text: promote "n" to "nike" once the burst settles ---
  const now = Date.now();
  const updates: Array<{ id: number; text: string; count: number }> = [];
  for (const [key, s] of sessions) {
    if (s.pendingText && s.analyticsId) {
      updates.push({ id: s.analyticsId, text: s.pendingText, count: s.pendingCount });
      s.pendingText = null;
    }
    if (now - s.lastSeen > SESSION_IDLE_MS) sessions.delete(key);
  }
  for (const u of updates) {
    try {
      await query(
        'UPDATE search_analytics SET query = ?, result_count = ? WHERE id = ?',
        [u.text.slice(0, 500), u.count, u.id]
      );
    } catch {
      // non-critical
    }
  }
};

let flushTimer: NodeJS.Timeout | null = null;

export const startMeteringFlusher = () => {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushMetering().catch((e) => console.error('Metering flush error:', e));
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
};

export const stopMeteringFlusher = async () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushMetering(); // don't lose the last window on shutdown
};

/**
 * search_analytics was previously created by a CREATE TABLE IF NOT EXISTS issued
 * on EVERY counted search — a DDL round trip per request. Create it once at boot.
 */
export const ensureSearchAnalyticsTable = async (): Promise<void> => {
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
};

/** Test seam — lets specs start from a clean slate. */
export const __resetMeteringState = () => {
  sessions.clear();
  usageBuffer.clear();
};
