/**
 * Razorpay plan mapping CLI (same data as Admin → Payment Settings → Plan mapping).
 *
 *   npx ts-node src/scripts/razorpay-plans.ts list
 *   npx ts-node src/scripts/razorpay-plans.ts map <test|live> <plans|hosting_plans> <localPlanId> <razorpayPlanId>
 *   npx ts-node src/scripts/razorpay-plans.ts unmap <test|live> <plans|hosting_plans> <localPlanId>
 *   npx ts-node src/scripts/razorpay-plans.ts verify     # checks the current mode's mappings against Razorpay
 *
 * Never creates Razorpay plans.
 */
import dotenv from 'dotenv';
dotenv.config();

import pool, { query } from '../config/database';
import { ensurePaymentTables, setPlanMapping, comparePlan, getRazorpayClient, PlanTable } from '../services/razorpay.service';
import { ensureHostingTables } from '../services/hosting.service';

const TABLES: PlanTable[] = ['plans', 'hosting_plans'];

async function list() {
    const mappings: any = await query('SELECT mode, plan_table, local_plan_id, razorpay_plan_id FROM razorpay_plan_mappings');
    for (const table of TABLES) {
        const plans: any = await query(`SELECT id, name, price, billing_period, is_active FROM ${table} ORDER BY id`);
        console.log(`\n${table}`);
        for (const p of plans) {
            const m = (mode: string) => mappings.find((x: any) => x.mode === mode && x.plan_table === table && Number(x.local_plan_id) === p.id)?.razorpay_plan_id || '—';
            console.log(`  #${p.id} ${p.name} ${p.billing_period} ${p.price}${p.is_active ? '' : ' (inactive)'}  test=${m('test')}  live=${m('live')}`);
        }
    }
}

async function verify() {
    const { client, config } = await getRazorpayClient();
    const mappings: any = await query('SELECT plan_table, local_plan_id, razorpay_plan_id FROM razorpay_plan_mappings WHERE mode = ?', [config.mode]);
    console.log(`Verifying ${mappings.length} ${config.mode} mapping(s), currency ${config.currency}`);
    let bad = 0;
    for (const m of mappings) {
        const rows: any = await query(`SELECT * FROM ${m.plan_table} WHERE id = ?`, [m.local_plan_id]);
        const plan = rows?.[0];
        try {
            const rzp: any = await client.plans.fetch(m.razorpay_plan_id);
            const problems = plan ? comparePlan(rzp, plan, config.currency) : ['local plan missing'];
            if (problems.length) bad++;
            console.log(`  ${problems.length ? '✗' : '✓'} ${m.plan_table} #${m.local_plan_id} → ${m.razorpay_plan_id} "${rzp?.item?.name}" ${rzp?.period} ${rzp?.item?.amount} ${rzp?.item?.currency} ${problems.join('; ')}`);
        } catch (e: any) {
            bad++;
            console.log(`  ✗ ${m.plan_table} #${m.local_plan_id} → ${m.razorpay_plan_id}: ${e?.error?.description || e?.message}`);
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
        const [mode, table, localId, rzpId] = args;
        if (!['test', 'live'].includes(mode) || !TABLES.includes(table as PlanTable) || !Number(localId)) {
            throw new Error('usage: map <test|live> <plans|hosting_plans> <localPlanId> <razorpayPlanId>');
        }
        const rows: any = await query(`SELECT id FROM ${table} WHERE id = ?`, [Number(localId)]);
        if (!rows.length) throw new Error(`${table} #${localId} not found`);
        await setPlanMapping(mode as 'test' | 'live', table as PlanTable, Number(localId), cmd === 'map' ? rzpId : null);
        console.log(`${cmd === 'map' ? 'Mapped' : 'Unmapped'} ${mode} ${table} #${localId}${cmd === 'map' ? ` → ${rzpId}` : ''}`);
        return;
    }
    throw new Error('commands: list | map | unmap | verify');
}

main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => pool.end());
