
import { query } from '../config/database';
import dotenv from 'dotenv';
dotenv.config();

async function checkTenant() {
    try {
        const tenants = await query('SELECT id, email, status, trial_ends_at, plan_id FROM tenants');
        console.log('Tenants:', tenants);

        const subscriptions = await query('SELECT * FROM subscriptions');
        console.log('Subscriptions:', subscriptions);
    } catch (error) {
        console.error('Error:', error);
    }
    process.exit();
}

checkTenant();
