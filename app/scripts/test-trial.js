// Temp test helper: toggle tenant 2 between expired-trial / active-trial / restored
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const mode = process.argv[2]; // 'expire' | 'extend' | 'restore'
    const c = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'cataseek',
    });

    if (mode === 'expire') {
        await c.query("UPDATE subscriptions SET status='cancelled' WHERE tenant_id=2 AND status='active'");
        await c.query("UPDATE tenants SET status='trial', trial_ends_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id=2");
    } else if (mode === 'extend') {
        await c.query("UPDATE tenants SET status='trial', trial_ends_at = DATE_ADD(NOW(), INTERVAL 14 DAY) WHERE id=2");
    } else if (mode === 'restore') {
        await c.query("UPDATE subscriptions SET status='active' WHERE tenant_id=2 AND plan_id IS NOT NULL ORDER BY id DESC LIMIT 1");
        await c.query("UPDATE tenants SET status='active' WHERE id=2");
    }

    const [r] = await c.query('SELECT api_key, store_domain, status, trial_ends_at FROM tenants WHERE id=2');
    console.log(JSON.stringify(r[0]));
    await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
