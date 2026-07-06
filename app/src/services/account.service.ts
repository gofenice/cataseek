import crypto from 'crypto';
import { query } from '../config/database';
import { sendTrialReminderEmail, sendTrialExpiredEmail, sendUsageAlertEmail } from './mailer.service';

// ─── Account lifecycle columns (lazy migration, run at startup) ───────────────
export async function ensureAccountColumns() {
    const alters = [
        // password reset
        "ALTER TABLE tenants ADD COLUMN reset_token_hash VARCHAR(64) NULL",
        "ALTER TABLE tenants ADD COLUMN reset_token_expires DATETIME NULL",
        // email verification
        "ALTER TABLE tenants ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE tenants ADD COLUMN verify_token_hash VARCHAR(64) NULL",
        // trial lifecycle emails (sent-once flags)
        "ALTER TABLE tenants ADD COLUMN trial_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE tenants ADD COLUMN trial_expired_notice_sent BOOLEAN NOT NULL DEFAULT FALSE",
        // legal
        "ALTER TABLE tenants ADD COLUMN terms_accepted_at DATETIME NULL",
        // usage alerts (period = YYYY-MM so flags reset each month)
        "ALTER TABLE tenants ADD COLUMN usage_alert_period VARCHAR(7) NULL",
        "ALTER TABLE tenants ADD COLUMN usage_alert_80_sent BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE tenants ADD COLUMN usage_alert_100_sent BOOLEAN NOT NULL DEFAULT FALSE",
    ];
    for (const sql of alters) {
        try { await query(sql); } catch (_) { /* column exists */ }
    }
}

// ─── Tokens ───────────────────────────────────────────────────────────────────
// Raw token goes in the email link; only its SHA-256 hash is stored.
export function generateToken(): { raw: string; hash: string } {
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
}

export function hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── Trial lifecycle email scheduler ──────────────────────────────────────────
// Runs every 6 hours (and shortly after boot). Each email is sent once per
// tenant, tracked via the sent flags above.
const REMINDER_DAYS_BEFORE = 3;

export async function runTrialEmailSweep() {
    // 1. Reminder: trial ends within N days, still no active subscription
    const expiring: any = await query(`
        SELECT t.id, t.email, t.store_name, t.trial_ends_at
        FROM tenants t
        WHERE t.role = 'merchant'
          AND t.status = 'trial'
          AND t.search_enabled = TRUE
          AND t.trial_reminder_sent = FALSE
          AND t.trial_ends_at IS NOT NULL
          AND t.trial_ends_at > NOW()
          AND t.trial_ends_at <= DATE_ADD(NOW(), INTERVAL ? DAY)
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'active')
    `, [REMINDER_DAYS_BEFORE]);

    for (const t of expiring) {
        const daysLeft = Math.max(1, Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 86400000));
        try {
            await sendTrialReminderEmail(t.email, t.store_name, new Date(t.trial_ends_at), daysLeft);
            await query('UPDATE tenants SET trial_reminder_sent = TRUE WHERE id = ?', [t.id]);
            console.log(`[Trial emails] Reminder sent to ${t.email} (${daysLeft}d left)`);
        } catch (e) {
            console.error(`[Trial emails] Reminder failed for ${t.email}:`, e);
        }
    }

    // 2. Expired notice: trial ended, still no active subscription
    const expired: any = await query(`
        SELECT t.id, t.email, t.store_name
        FROM tenants t
        WHERE t.role = 'merchant'
          AND t.status = 'trial'
          AND t.search_enabled = TRUE
          AND t.trial_expired_notice_sent = FALSE
          AND t.trial_ends_at IS NOT NULL
          AND t.trial_ends_at <= NOW()
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'active')
    `);

    for (const t of expired) {
        try {
            await sendTrialExpiredEmail(t.email, t.store_name);
            await query('UPDATE tenants SET trial_expired_notice_sent = TRUE WHERE id = ?', [t.id]);
            console.log(`[Trial emails] Expiry notice sent to ${t.email}`);
        } catch (e) {
            console.error(`[Trial emails] Expiry notice failed for ${t.email}:`, e);
        }
    }
}

// ─── Usage-alert email sweep ──────────────────────────────────────────────────
// Emails once at 80% and once at 100% of the monthly search limit, per cycle.
// Flags reset automatically when the calendar month changes.
export async function runUsageAlertSweep() {
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    // Reset flags for tenants whose stored period is not the current month
    await query(
        "UPDATE tenants SET usage_alert_period = ?, usage_alert_80_sent = FALSE, usage_alert_100_sent = FALSE WHERE usage_alert_period IS NULL OR usage_alert_period <> ?",
        [period, period]
    );

    // Active, search-enabled tenants with a plan limit and current-month usage
    const rows: any = await query(`
        SELECT t.id, t.email, t.store_name, t.usage_alert_80_sent, t.usage_alert_100_sent,
               p.name AS plan_name, p.max_requests_per_month AS lim,
               (SELECT COALESCE(SUM(request_count),0) FROM api_usage u
                  WHERE u.tenant_id = t.id
                    AND u.date >= DATE_FORMAT(NOW(), '%Y-%m-01')
                    AND u.endpoint IN ('/products/search','/products/public/search')) AS used
        FROM tenants t
        JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
        JOIN plans p ON s.plan_id = p.id
        WHERE t.role = 'merchant' AND t.search_enabled = TRUE AND p.max_requests_per_month > 0
    `);

    for (const t of rows) {
        const used = Number(t.used) || 0;
        const limit = Number(t.lim) || 0;
        if (limit <= 0) continue;
        const percent = Math.round((used / limit) * 100);

        try {
            if (percent >= 100 && !t.usage_alert_100_sent) {
                await sendUsageAlertEmail(t.email, t.store_name, t.plan_name, used, limit, 100);
                await query('UPDATE tenants SET usage_alert_100_sent = TRUE, usage_alert_80_sent = TRUE WHERE id = ?', [t.id]);
                console.log(`[Usage alerts] 100% notice sent to ${t.email}`);
            } else if (percent >= 80 && !t.usage_alert_80_sent) {
                await sendUsageAlertEmail(t.email, t.store_name, t.plan_name, used, limit, percent);
                await query('UPDATE tenants SET usage_alert_80_sent = TRUE WHERE id = ?', [t.id]);
                console.log(`[Usage alerts] ${percent}% notice sent to ${t.email}`);
            }
        } catch (e) {
            console.error(`[Usage alerts] failed for ${t.email}:`, e);
        }
    }
}

export function startTrialEmailScheduler() {
    // First sweep shortly after boot, then every 6 hours
    setTimeout(() => runTrialEmailSweep().catch(e => console.error('Trial sweep error:', e)), 30 * 1000);
    setInterval(() => runTrialEmailSweep().catch(e => console.error('Trial sweep error:', e)), 6 * 60 * 60 * 1000);

    // Usage alerts: shortly after boot, then hourly
    setTimeout(() => runUsageAlertSweep().catch(e => console.error('Usage sweep error:', e)), 45 * 1000);
    setInterval(() => runUsageAlertSweep().catch(e => console.error('Usage sweep error:', e)), 60 * 60 * 1000);
}
