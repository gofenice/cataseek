import { query } from '../config/database';

async function checkSchema() {
    try {
        const rows: any = await query('DESCRIBE tenants');
        console.log('--- Tenants Schema ---');
        console.table(rows);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

checkSchema();
