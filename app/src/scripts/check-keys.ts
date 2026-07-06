import { query } from '../config/database';

async function checkTenants() {
    try {
        const rows: any = await query('SELECT id, store_name, api_key FROM tenants');
        console.log('--- Tenants List ---');
        rows.forEach((row: any) => {
            console.log(`ID: ${row.id}`);
            console.log(`Store: ${row.store_name}`);
            console.log(`API Key: "${row.api_key}"`);
            console.log(`Key Length: ${row.api_key?.length}`);
            console.log('-------------------');
        });
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

checkTenants();
