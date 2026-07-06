/**
 * Seed script: creates the admin account.
 * Credentials come from env (.env): ADMIN_EMAIL, ADMIN_PASSWORD.
 * Run once: npx ts-node src/scripts/seed-admin.ts
 */
import 'dotenv/config';
import crypto from 'crypto';
import { query } from '../config/database';
import { hashPassword } from '../utils/auth';

async function seedAdmin() {
    const email = process.env.ADMIN_EMAIL || 'gofenice@admin.com';
    // If no password configured, generate a strong random one and print it once
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const storeName = 'Gofenice Admin';
    const storeDomain = 'admin.gofenice.internal';

    try {
        const existing: any = await query('SELECT id FROM tenants WHERE email = ?', [email]);
        if (existing && existing.length > 0) {
            console.log('✅ Admin already exists, updating role...');
            await query("UPDATE tenants SET role = 'admin', status = 'active' WHERE email = ?", [email]);
            console.log('✅ Admin role updated. (Password unchanged — use reset-admin-password.ts to rotate it.)');
            process.exit(0);
        }

        const passwordHash = await hashPassword(password);

        await query(
            `INSERT INTO tenants (store_name, store_domain, email, password_hash, role, status)
       VALUES (?, ?, ?, ?, 'admin', 'active')`,
            [storeName, storeDomain, email, passwordHash]
        );

        console.log('✅ Admin account created successfully!');
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${password}`);
        if (!process.env.ADMIN_PASSWORD) {
            console.log('   ⚠️ Save this password now — it was randomly generated and will not be shown again.');
        }
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to seed admin:', err);
        process.exit(1);
    }
}

seedAdmin();
