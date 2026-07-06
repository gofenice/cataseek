import pool, { query } from '../config/database';
import client from '../config/meilisearch';

async function cleanup() {
    console.log('🧹 Starting Cataseek Data Cleanup...\n');

    try {
        // 1. Drop specific legacy tables
        const legacyTables = ['Tenant', '_prisma_migrations', 'users'];
        for (const table of legacyTables) {
            try {
                await query(`DROP TABLE IF EXISTS ${table}`);
                console.log(`✅ Dropped legacy table: ${table}`);
            } catch (e) {
                console.warn(`⚠️ Could not drop ${table} (it might not exist)`);
            }
        }

        // 2. Identify and drop dynamic product tables
        const tables: any = await query("SHOW TABLES");
        const productTables = tables
            .map((row: any) => Object.values(row)[0] as string)
            .filter((name: string) => name.startsWith('products_'));

        for (const table of productTables) {
            await query(`DROP TABLE IF EXISTS ${table}`);
            console.log(`✅ Dropped product table: ${table}`);
        }

        // 3. Delete all Meilisearch indexes
        const indexes = await client.getIndexes();
        for (const idx of indexes.results) {
            await client.deleteIndex(idx.uid);
            console.log(`✅ Deleted Meilisearch index: ${idx.uid}`);
        }

        // 4. Truncate core tables (using DELETE to keep schema intact)
        // We disable foreign key checks temporarily to clear everything
        await query('SET FOREIGN_KEY_CHECKS = 0');
        await query('TRUNCATE TABLE api_usage');
        await query('TRUNCATE TABLE subscriptions');
        await query('TRUNCATE TABLE tenants');
        await query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('✅ Core tables (tenants, subscriptions, api_usage) truncated.');

        console.log('\n✨ Cleanup complete! The system is now reset.');

    } catch (error) {
        console.error('❌ Cleanup failed:', error);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

cleanup();
