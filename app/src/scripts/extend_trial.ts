
import { query } from '../config/database';
import dotenv from 'dotenv';
dotenv.config();

async function extendTrial() {
    try {
        // Set trial to end 30 days from now
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        const dateStr = futureDate.toISOString().slice(0, 19).replace('T', ' ');

        await query('UPDATE tenants SET trial_ends_at = ? WHERE id = 2', [dateStr]);
        console.log(`Updated tenant 2 trial_ends_at to ${dateStr}`);

        const tenant = await query('SELECT * FROM tenants WHERE id = 2');
        console.log('Updated tenant:', tenant);
    } catch (error) {
        console.error('Error:', error);
    }
    process.exit();
}

extendTrial();
