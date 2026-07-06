import { query } from '../config/database';

// ─── Platform settings (key-value) ────────────────────────────────────────────
// Stores admin-configurable payment gateway credentials (Razorpay).
// Secrets live in the DB so the admin can manage them from the dashboard
// without redeploying. Values are cached in-memory for 60s.

export interface RazorpayConfig {
    enabled: boolean;
    mode: 'test' | 'live';
    key_id: string;
    key_secret: string;
    webhook_secret: string;
    currency: string;
}

const SETTING_KEYS = [
    'razorpay_enabled',
    'razorpay_mode',
    'razorpay_key_id',
    'razorpay_key_secret',
    'razorpay_webhook_secret',
    'payment_currency',
] as const;

const COMPANY_KEYS = [
    'company_name',
    'company_email',
    'company_address',
    'company_gstin',
    'tax_rate',
    'tax_label',
] as const;

export interface CompanyConfig {
    company_name: string;
    company_email: string;
    company_address: string;
    company_gstin: string;
    tax_rate: number;     // percent, 0 = no tax line
    tax_label: string;    // e.g. "GST"
}

let companyCache: { value: CompanyConfig; expiresAt: number } | null = null;

export async function getCompanyConfig(skipCache = false): Promise<CompanyConfig> {
    if (!skipCache && companyCache && Date.now() < companyCache.expiresAt) return companyCache.value;
    await ensurePlatformSettingsTable();
    const rows: any = await query(
        `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${COMPANY_KEYS.map(() => '?').join(',')})`,
        [...COMPANY_KEYS]
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.setting_key] = r.setting_value;

    const config: CompanyConfig = {
        company_name: map.company_name || process.env.COMPANY_NAME || 'Cataseek',
        company_email: map.company_email || process.env.COMPANY_EMAIL || 'billing@cataseek.com',
        company_address: map.company_address || '',
        company_gstin: map.company_gstin || '',
        tax_rate: map.tax_rate ? parseFloat(map.tax_rate) : 0,
        tax_label: map.tax_label || 'GST',
    };
    companyCache = { value: config, expiresAt: Date.now() + 60 * 1000 };
    return config;
}

export async function saveCompanyConfig(partial: Partial<CompanyConfig>): Promise<void> {
    await ensurePlatformSettingsTable();
    const updates: Array<[string, string]> = [];
    if (partial.company_name !== undefined) updates.push(['company_name', String(partial.company_name).trim()]);
    if (partial.company_email !== undefined) updates.push(['company_email', String(partial.company_email).trim()]);
    if (partial.company_address !== undefined) updates.push(['company_address', String(partial.company_address).trim()]);
    if (partial.company_gstin !== undefined) updates.push(['company_gstin', String(partial.company_gstin).trim()]);
    if (partial.tax_rate !== undefined) updates.push(['tax_rate', String(Number(partial.tax_rate) || 0)]);
    if (partial.tax_label !== undefined) updates.push(['tax_label', String(partial.tax_label).trim() || 'GST']);

    for (const [key, value] of updates) {
        await query(
            `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
            [key, value]
        );
    }
    companyCache = null;
}

let cache: { value: RazorpayConfig; expiresAt: number } | null = null;

export async function ensurePlatformSettingsTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS platform_settings (
            setting_key   VARCHAR(64) PRIMARY KEY,
            setting_value TEXT,
            updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

export async function getRazorpayConfig(skipCache = false): Promise<RazorpayConfig> {
    if (!skipCache && cache && Date.now() < cache.expiresAt) return cache.value;

    await ensurePlatformSettingsTable();
    const rows: any = await query(
        `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${SETTING_KEYS.map(() => '?').join(',')})`,
        [...SETTING_KEYS]
    );

    const map: Record<string, string> = {};
    for (const row of rows) map[row.setting_key] = row.setting_value;

    const config: RazorpayConfig = {
        enabled: map.razorpay_enabled === 'true',
        mode: map.razorpay_mode === 'live' ? 'live' : 'test',
        key_id: map.razorpay_key_id || '',
        key_secret: map.razorpay_key_secret || '',
        webhook_secret: map.razorpay_webhook_secret || '',
        currency: map.payment_currency || 'INR',
    };

    cache = { value: config, expiresAt: Date.now() + 60 * 1000 };
    return config;
}

export async function saveRazorpayConfig(partial: Partial<RazorpayConfig>): Promise<void> {
    await ensurePlatformSettingsTable();

    const updates: Array<[string, string]> = [];
    if (partial.enabled !== undefined) updates.push(['razorpay_enabled', String(!!partial.enabled)]);
    if (partial.mode !== undefined) updates.push(['razorpay_mode', partial.mode === 'live' ? 'live' : 'test']);
    if (partial.key_id !== undefined) updates.push(['razorpay_key_id', partial.key_id.trim()]);
    if (partial.key_secret !== undefined && partial.key_secret !== '') updates.push(['razorpay_key_secret', partial.key_secret.trim()]);
    if (partial.webhook_secret !== undefined && partial.webhook_secret !== '') updates.push(['razorpay_webhook_secret', partial.webhook_secret.trim()]);
    if (partial.currency !== undefined) updates.push(['payment_currency', partial.currency.trim().toUpperCase() || 'INR']);

    for (const [key, value] of updates) {
        await query(
            `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
            [key, value]
        );
    }

    cache = null; // invalidate
}

// Mask a secret for safe display: keep first 4 + last 4 chars
export function maskSecret(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 8) return '••••••••';
    return `${secret.slice(0, 4)}${'•'.repeat(8)}${secret.slice(-4)}`;
}
