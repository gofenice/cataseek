import { query } from '../config/database';

// ─── Yearly plan auto-sync ─────────────────────────────────────────────────────
// Both `plans` and `hosting_plans` are monthly-first: the monthly row is the
// sole editable source of truth, and its yearly sibling (linked via
// parent_plan_id) is auto-generated/kept in sync from it, priced at
// price * 12 * (1 - yearly_discount_percent / 100). Never call this with a
// row that isn't the monthly root — it no-ops in that case.

type PlanTable = 'plans' | 'hosting_plans';

const MIRRORED_FIELDS: Record<PlanTable, string[]> = {
    plans: ['name', 'description', 'max_products', 'max_requests_per_month', 'features', 'is_active'],
    hosting_plans: ['name', 'storage_gb', 'ram_gb', 'bandwidth', 'is_active'],
};

function clampDiscount(pct: any): number {
    const n = Number(pct) || 0;
    return Math.min(99, Math.max(0, n));
}

export async function syncYearlyVariant(table: PlanTable, monthlyPlanId: number): Promise<void> {
    const rows: any = await query(`SELECT * FROM ${table} WHERE id = ?`, [monthlyPlanId]);
    const monthly = rows?.[0];
    if (!monthly || monthly.billing_period !== 'monthly') return; // only sync from a monthly root

    const discount = clampDiscount(monthly.yearly_discount_percent);
    const yearlyPrice = Math.round(Number(monthly.price) * 12 * (1 - discount / 100) * 100) / 100;

    const mirrored = MIRRORED_FIELDS[table];
    const values: any[] = mirrored.map(f => monthly[f]);

    const existing: any = await query(
        `SELECT id FROM ${table} WHERE parent_plan_id = ? AND billing_period = 'yearly' LIMIT 1`,
        [monthlyPlanId]
    );

    if (existing && existing.length > 0) {
        const setClauses = mirrored.map(f => `${f} = ?`).join(', ');
        await query(
            `UPDATE ${table} SET ${setClauses}, price = ?, yearly_discount_percent = ?, updated_at = NOW() WHERE id = ?`,
            [...values, yearlyPrice, discount, existing[0].id]
        );
    } else {
        const columns = [...mirrored, 'price', 'billing_period', 'yearly_discount_percent', 'parent_plan_id'];
        const placeholders = columns.map(() => '?').join(', ');
        await query(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
            [...values, yearlyPrice, 'yearly', discount, monthlyPlanId]
        );
    }
}

export async function backfillYearlyVariants(table: PlanTable): Promise<void> {
    const monthlyPlans: any = await query(
        `SELECT id FROM ${table}
         WHERE billing_period = 'monthly'
           AND id NOT IN (
             SELECT parent_plan_id FROM ${table} WHERE parent_plan_id IS NOT NULL
           )`
    );
    for (const p of monthlyPlans || []) {
        await syncYearlyVariant(table, p.id);
    }
}
