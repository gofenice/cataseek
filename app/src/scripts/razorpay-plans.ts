/**
 * Razorpay plan mapping CLI (same data as Admin → Payment Settings → Plan mapping).
 *
 *   npx ts-node src/scripts/razorpay-plans.ts list
 *   npx ts-node src/scripts/razorpay-plans.ts map <test|live> <plans|hosting_plans> <localPlanId> <razorpayPlanId> [currency]
 *   npx ts-node src/scripts/razorpay-plans.ts unmap <test|live> <plans|hosting_plans> <localPlanId> [currency]
 *   npx ts-node src/scripts/razorpay-plans.ts verify     # checks the current mode's mappings against Razorpay
 *
 * currency defaults to the base currency. Never creates Razorpay plans.
 */
import dotenv from 'dotenv';
dotenv.config();

import pool, { query } from '../config/database';
import { ensurePaymentTables, setPlanMapping, comparePlan, getRazorpayClient, fetchAllRazorpayPlans, withRateLimitRetry, PlanTable } from '../services/razorpay.service';
import { ensureHostingTables } from '../services/hosting.service';
import { SUPPORTED_CURRENCIES, getBaseCurrency, localizePlan } from '../services/currency.service';

const TABLES: PlanTable[] = ['plans', 'hosting_plans'];

async function list() {
    const base = await getBaseCurrency();
    const mappings: any = await query('SELECT mode, plan_table, local_plan_id, currency, razorpay_plan_id FROM razorpay_plan_mappings');
    const prices: any = await query('SELECT plan_table, local_plan_id, currency, price FROM plan_prices');
    for (const table of TABLES) {
        const plans: any = await query(`SELECT id, name, price, billing_period, is_active FROM ${table} ORDER BY id`);
        console.log(`\n${table}`);
        for (const p of plans) {
            const mine = (x: any) => x.plan_table === table && Number(x.local_plan_id) === p.id;
            console.log(`  #${p.id} ${p.name} ${p.billing_period}${p.is_active ? '' : ' (inactive)'}`);
            for (const currency of [base, ...SUPPORTED_CURRENCIES.filter((c) => c !== base)]) {
                const price = currency === base ? p.price : prices.find((x: any) => mine(x) && x.currency === currency)?.price;
                const m = (mode: string) => mappings.find((x: any) => mine(x) && x.mode === mode && x.currency === currency)?.razorpay_plan_id || '—';
                if (price === undefined && m('test') === '—' && m('live') === '—') continue;
                console.log(`      ${currency} ${price ?? '(no price)'}  test=${m('test')}  live=${m('live')}`);
            }
        }
    }
}

async function verify() {
    const { client, config } = await getRazorpayClient();
    const mappings: any = await query('SELECT plan_table, local_plan_id, currency, razorpay_plan_id FROM razorpay_plan_mappings WHERE mode = ?', [config.mode]);
    console.log(`Verifying ${mappings.length} ${config.mode} mapping(s)`);
    const rzpPlans = await fetchAllRazorpayPlans(client);
    let bad = 0;
    for (const m of mappings) {
        const rows: any = await query(`SELECT * FROM ${m.plan_table} WHERE id = ?`, [m.local_plan_id]);
        const plan = await localizePlan(m.plan_table, rows?.[0], m.currency);
        try {
            const rzp: any = rzpPlans.get(m.razorpay_plan_id) || await withRateLimitRetry(() => client.plans.fetch(m.razorpay_plan_id));
            const problems = plan ? comparePlan(rzp, plan, m.currency) : [rows?.[0] ? `no ${m.currency} price set` : 'local plan missing'];
            if (problems.length) bad++;
            console.log(`  ${problems.length ? '✗' : '✓'} ${m.plan_table} #${m.local_plan_id} ${m.currency} → ${m.razorpay_plan_id} "${rzp?.item?.name}" ${rzp?.period} ${rzp?.item?.amount} ${rzp?.item?.currency} ${problems.join('; ')}`);
        } catch (e: any) {
            bad++;
            console.log(`  ✗ ${m.plan_table} #${m.local_plan_id} ${m.currency} → ${m.razorpay_plan_id}: ${e?.error?.description || e?.message}`);
        }
    }
    if (bad) process.exitCode = 1;
}

async function main() {
    await ensureHostingTables();
    await ensurePaymentTables();
    const [cmd, ...args] = process.argv.slice(2);

    if (cmd === 'list') return list();
    if (cmd === 'verify') return verify();
    if (cmd === 'map' || cmd === 'unmap') {
        const [mode, table, localId] = args;
        const rzpId = cmd === 'map' ? args[3] : null;
        const base = await getBaseCurrency();
        const currency = String((cmd === 'map' ? args[4] : args[3]) || base).toUpperCase();
        if (!['test', 'live'].includes(mode) || !TABLES.includes(table as PlanTable) || !Number(localId)
            || ![base, ...SUPPORTED_CURRENCIES].includes(currency)) {
            throw new Error('usage: map <test|live> <plans|hosting_plans> <localPlanId> <razorpayPlanId> [currency]');
        }
        const rows: any = await query(`SELECT id FROM ${table} WHERE id = ?`, [Number(localId)]);
        if (!rows.length) throw new Error(`${table} #${localId} not found`);
        await setPlanMapping(mode as 'test' | 'live', table as PlanTable, Number(localId), currency, rzpId);
        console.log(`${cmd === 'map' ? 'Mapped' : 'Unmapped'} ${mode} ${table} #${localId} ${currency}${cmd === 'map' ? ` → ${rzpId}` : ''}`);
        return;
    }
    throw new Error('commands: list | map | unmap | verify');
}

main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => pool.end());
