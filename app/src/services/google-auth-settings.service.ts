import { query } from '../config/database';
import { ensurePlatformSettingsTable } from './payment-settings.service';

// ─── Google Sign-In config (admin-configurable) ────────────────────────────────
// Reuses the same platform_settings key-value table as Razorpay/company config.
// No client secret is stored here — the Google Identity Services client-side
// flow only needs a Client ID (not secret information) to verify ID tokens.

export interface GoogleAuthConfig {
    enabled: boolean;
    clientId: string;
}

const SETTING_KEYS = ['google_oauth_enabled', 'google_client_id'] as const;

let cache: { value: GoogleAuthConfig; expiresAt: number } | null = null;

export async function getGoogleAuthConfig(skipCache = false): Promise<GoogleAuthConfig> {
    if (!skipCache && cache && Date.now() < cache.expiresAt) return cache.value;

    await ensurePlatformSettingsTable();
    const rows: any = await query(
        `SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN (${SETTING_KEYS.map(() => '?').join(',')})`,
        [...SETTING_KEYS]
    );

    const map: Record<string, string> = {};
    for (const row of rows) map[row.setting_key] = row.setting_value;

    const config: GoogleAuthConfig = {
        enabled: map.google_oauth_enabled === 'true' && !!map.google_client_id,
        clientId: map.google_client_id || '',
    };

    cache = { value: config, expiresAt: Date.now() + 60 * 1000 };
    return config;
}

export async function saveGoogleAuthConfig(partial: Partial<GoogleAuthConfig>): Promise<void> {
    await ensurePlatformSettingsTable();

    const updates: Array<[string, string]> = [];
    if (partial.enabled !== undefined) updates.push(['google_oauth_enabled', String(!!partial.enabled)]);
    if (partial.clientId !== undefined) updates.push(['google_client_id', partial.clientId.trim()]);

    for (const [key, value] of updates) {
        await query(
            `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
            [key, value]
        );
    }

    cache = null;
}
