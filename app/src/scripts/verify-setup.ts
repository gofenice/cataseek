import { query } from '../config/database';
import client from '../config/meilisearch';

async function verify() {
    console.log('🔍 Verifying Cataseek Setup...\n');

    try {
        // 1. Get Plans
        const plans: any = await query('SELECT id, name FROM plans');
        console.log('📊 Available Plans:');
        console.table(plans);

        // 2. Get Meilisearch Indexes
        const indexes = await client.getIndexes();
        console.log('\n🔍 Meilisearch Indexes:');
        if (indexes.results.length === 0) {
            console.log('   (No indexes found)');
        } else {
            indexes.results.forEach(idx => console.log(`   - ${idx.uid}`));
        }

        // 3. Check for Legacy Tables
        const tables: any = await query("SHOW TABLES");
        console.log('\n📋 Database Tables:');
        tables.forEach((row: any) => {
            const tableName = Object.values(row)[0];
            console.log(`   - ${tableName}`);
        });

    } catch (error) {
        console.error('❌ Verification failed:', error);
    } finally {
        process.exit(0);
    }
}

verify();
