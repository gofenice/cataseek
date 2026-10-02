import { Request } from 'express';
import { query } from '../config/database';
import { ensurePlatformSettingsTable, getRazorpayConfig } from './payment-settings.service';

// ─── Multi-currency pricing ───────────────────────────────────────────────────
// `plans.price` / `hosting_plans.price` hold the BASE currency price (Admin →
// Payment Settings → currency). Every other currency a plan is sold in has its
// own fixed price in `plan_prices` and its own Razorpay plan (a Razorpay plan
// has exactly one currency). A tenant is billed in one currency: the one of its
// running subscription, else the one it chose, else the one for its country.

export type PlanTable = 'plans' | 'hosting_plans';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];

// Countries shown EUR. Everything not listed here, IN or GB falls back to the base currency.
const EUROPE = new Set([
    // Eurozone
    'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
    // Rest of the EU / EEA / Switzerland
    'BG', 'CZ', 'DK', 'HU', 'PL', 'RO', 'SE', 'IS', 'LI', 'NO', 'CH',
    // Microstates and the rest of Europe
    'AD', 'MC', 'SM', 'VA', 'AL', 'BA', 'ME', 'MK', 'RS', 'XK', 'MD', 'UA',
]);
const UK = new Set(['GB', 'IM', 'JE', 'GG']);

export function currencyForCountry(country: string | null): string | null {
    if (!country) return null;
    if (country === 'IN') return 'INR';
    if (UK.has(country)) return 'GBP';
    if (EUROPE.has(country)) return 'EUR';
    return 'USD';
}

// Cloudflare adds the visitor's country to every request it proxies. Locally
// (no Cloudflare) set GEO_COUNTRY_OVERRIDE=IN to test another country.
export function countryFromRequest(req?: Request | null): string | null {
    const raw = process.env.GEO_COUNTRY_OVERRIDE || (req?.headers?.['cf-ipcountry'] as string) || '';
    const country = String(raw).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null;
}

// ─── Tables ───────────────────────────────────────────────────────────────────
let migration: Promise<void> | null = null;
export function ensureCurrencyTables(): Promise<void> {
    if (!migration) {
        migration = runCurrencyMigrations().catch((e) => { migration = null; throw e; });
    }
    return migration;
}

async function runCurrencyMigrations() {
    await query(`
        CREATE TABLE IF NOT EXISTS plan_prices (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            plan_table    ENUM('plans','hosting_plans') NOT NULL,
            local_plan_id INT NOT NULL,
            currency      VARCHAR(3) NOT NULL,
            price         DECIMAL(10,2) NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_plan_currency (plan_table, local_plan_id, currency)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // billing_currency: picked with the currency switcher (NULL = follow the country)
    try { await query('ALTER TABLE tenants ADD COLUMN billing_currency VARCHAR(3) NULL'); } catch (_) { /* exists */ }
    try { await query('ALTER TABLE tenants ADD COLUMN country_code VARCHAR(2) NULL'); } catch (_) { /* exists */ }
}

// ─── Enabled currencies ───────────────────────────────────────────────────────
const EXTRA_CURRENCIES_KEY = 'billing_extra_currencies';
let enabledCache: { value: string[]; expiresAt: number } | null = null;

export async function getBaseCurrency(): Promise<string> {
    return (await getRazorpayConfig()).currency.toUpperCase();
}

// Base currency first, then the extra currencies the admin switched on.
export async function getEnabledCurrencies(skipCache = false): Promise<string[]> {
    const base = await getBaseCurrency();
    if (!skipCache && enabledCache && Date.now() < enabledCache.expiresAt && enabledCache.value[0] === base) {
        return enabledCache.value;
    }
    await ensurePlatformSettingsTable();
    const rows: any = await query('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [EXTRA_CURRENCIES_KEY]);
    const extras = String(rows?.[0]?.setting_value || '')
        .split(',').map((c) => c.trim().toUpperCase())
        .filter((c) => SUPPORTED_CURRENCIES.includes(c) && c !== base);
    const value = [base, ...Array.from(new Set(extras))];
    enabledCache = { value, expiresAt: Date.now() + 60 * 1000 };
    return value;
}

export async function saveExtraCurrencies(currencies: string[]): Promise<void> {
    await ensurePlatformSettingsTable();
    await query(
        `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
        [EXTRA_CURRENCIES_KEY, currencies.join(',')]
    );
    enabledCache = null;
}

// ─── Plan prices ──────────────────────────────────────────────────────────────
export async function setPlanPrice(table: PlanTable, planId: number, currency: string, price: number | null): Promise<void> {
    await ensureCurrencyTables();
    if (price === null) {
        await query('DELETE FROM plan_prices WHERE plan_table = ? AND local_plan_id = ? AND currency = ?', [table, planId, currency]);
        return;
    }
    await query(
        `INSERT INTO plan_prices (plan_table, local_plan_id, currency, price) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE price = VALUES(price), updated_at = NOW()`,
        [table, planId, currency, price]
    );
}

// The plan as sold in `currency`: same row with `price` in that currency and a
// `currency` field. null when the plan has no price in that currency.
export async function localizePlan(table: PlanTable, plan: any, currency?: string | null): Promise<any | null> {
    if (!plan) return null;
    const localized = await localizePlans(table, [plan], currency);
    return localized[0] || null;
}

// Plans without a price in `currency` are left out.
export async function localizePlans(table: PlanTable, plans: any[], currency?: string | null): Promise<any[]> {
    const base = await getBaseCurrency();
    const target = String(currency || base).toUpperCase();
    if (target === base) return plans.map((p) => ({ ...p, currency: base }));
    if (plans.length === 0) return [];

    await ensureCurrencyTables();
    const rows: any = await query(
        `SELECT local_plan_id, price FROM plan_prices
         WHERE plan_table = ? AND currency = ? AND local_plan_id IN (${plans.map(() => '?').join(',')})`,
        [table, target, ...plans.map((p) => p.id)]
    );
    const prices = new Map<number, string>(rows.map((r: any) => [Number(r.local_plan_id), r.price]));
    return plans
        .filter((p) => prices.has(Number(p.id)))
        .map((p) => ({ ...p, price: prices.get(Number(p.id)), currency: target }));
}

// SQL: join the price a subscription's plan has in that subscription's currency.
// Select COALESCE(<alias>.price, <planAlias>.price) — base-currency (and legacy
// NULL-currency) subscriptions have no plan_prices row and use the plan's own price.
export function subscriptionPriceJoin(table: PlanTable, planAlias: string, subAlias: string, alias: string): string {
    return `LEFT JOIN plan_prices ${alias} ON ${alias}.plan_table = '${table}' AND ${alias}.local_plan_id = ${planAlias}.id AND ${alias}.currency = ${subAlias}.currency`;
}

// ─── Which currency a tenant is billed in ─────────────────────────────────────
export interface TenantCurrency {
    currency: string;
    // A running subscription fixes the currency: renewals, plan changes and
    // invoices of one customer never mix currencies.
    locked: boolean;
    options: string[];
    country: string | null;
    source: 'subscription' | 'chosen' | 'country' | 'default';
}

async function runningSubscriptionCurrency(tenantId: number, base: string): Promise<string | null> {
    for (const table of ['subscriptions', 'hosting_subscriptions']) {
        try {
            const rows: any = await query(
                `SELECT currency FROM ${table}
                 WHERE tenant_id = ? AND status IN ('active','trialing')
                 ORDER BY id DESC LIMIT 1`,
                [tenantId]
            );
            if (rows.length > 0) return String(rows[0].currency || base).toUpperCase();
        } catch (_) { /* hosting tables / currency column not created yet */ }
    }
    return null;
}

export async function resolveTenantCurrency(tenantId: number, req?: Request | null): Promise<TenantCurrency> {
    await ensureCurrencyTables();
    const options = await getEnabledCurrencies();
    const base = options[0];

    const rows: any = await query('SELECT billing_currency, country_code FROM tenants WHERE id = ?', [tenantId]);
    const tenant = rows?.[0] || {};

    // Remember where the tenant was first seen from (reference only)
    const seenCountry = countryFromRequest(req);
    if (seenCountry && !tenant.country_code) {
        await query('UPDATE tenants SET country_code = ? WHERE id = ? AND country_code IS NULL', [seenCountry, tenantId]);
    }
    const country = seenCountry || tenant.country_code || null;

    const running = await runningSubscriptionCurrency(tenantId, base);
    if (running) return { currency: running, locked: true, options, country, source: 'subscription' };

    const chosen = String(tenant.billing_currency || '').toUpperCase();
    if (chosen && options.includes(chosen)) return { currency: chosen, locked: false, options, country, source: 'chosen' };

    const byCountry = currencyForCountry(country);
    if (byCountry && options.includes(byCountry)) return { currency: byCountry, locked: false, options, country, source: 'country' };

    return { currency: base, locked: false, options, country, source: 'default' };
}

// Visitors without an account (marketing site pricing): country only.
export async function resolveVisitorCurrency(req: Request, requested?: string | null): Promise<string> {
    const options = await getEnabledCurrencies();
    const wanted = String(requested || '').toUpperCase();
    if (wanted && options.includes(wanted)) return wanted;
    const byCountry = currencyForCountry(countryFromRequest(req));
    return byCountry && options.includes(byCountry) ? byCountry : options[0];
}

export async function setTenantCurrency(tenantId: number, currency: string): Promise<void> {
    await ensureCurrencyTables();
    await query('UPDATE tenants SET billing_currency = ? WHERE id = ?', [currency, tenantId]);
}

// ─── Money formatting (emails) ────────────────────────────────────────────────
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

export function formatMoney(amount: number | string, currency?: string | null): string {
    const code = String(currency || 'USD').toUpperCase();
    const n = Number(amount) || 0;
    const digits = Number.isInteger(n) ? 0 : 2;
    const text = n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 });
    return `${SYMBOLS[code] || ''}${text} ${code}`;
}
