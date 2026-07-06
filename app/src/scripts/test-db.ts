import { query } from '../config/database';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test database connection and display current state
 */
async function testConnection() {
    console.log('🔍 Testing Cataseek Database Connection...\n');

    try {
        // Test basic connection
        const result: any = await query('SELECT 1 + 1 AS result');
        console.log('✅ Database connection successful!');
        console.log(`   Result: ${result[0].result}\n`);

        // Check if tables exist
        const tables: any = await query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME IN ('tenants', 'plans', 'subscriptions', 'api_usage')
      ORDER BY TABLE_NAME
    `, [process.env.DB_NAME]);

        if (tables.length === 0) {
            console.log('⚠️  No Cataseek tables found!');
            console.log('   Run: ./scripts/setup-database.sh\n');
            return;
        }

        console.log('📊 Found tables:');
        tables.forEach((table: any) => {
            console.log(`   ✓ ${table.TABLE_NAME}`);
        });
        console.log('');

        // Count existing data
        const tenantCount: any = await query('SELECT COUNT(*) as count FROM tenants');
        const planCount: any = await query('SELECT COUNT(*) as count FROM plans');

        console.log('📈 Current data:');
        console.log(`   Tenants: ${tenantCount[0].count}`);
        console.log(`   Plans: ${planCount[0].count}`);

        if (planCount[0].count > 0) {
            const plans: any = await query('SELECT id, name, price, max_products FROM plans');
            console.log('\n💳 Available plans:');
            plans.forEach((plan: any) => {
                console.log(`   • ${plan.name}: $${plan.price}/mo (${plan.max_products} products)`);
            });
        }

        console.log('\n✅ Database is ready!\n');

    } catch (error: any) {
        console.error('❌ Database connection failed!');
        console.error(`   Error: ${error.message}\n`);

        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Troubleshooting:');
            console.log('   1. Check if MySQL is running');
            console.log('   2. Verify DB_HOST in .env file');
            console.log('   3. Check firewall settings\n');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.log('💡 Troubleshooting:');
            console.log('   1. Verify DB_USER in .env file');
            console.log('   2. Verify DB_PASSWORD in .env file');
            console.log('   3. Check MySQL user permissions\n');
        }

        process.exit(1);
    }

    process.exit(0);
}

testConnection();
