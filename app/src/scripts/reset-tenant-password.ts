/**
 * Rotates a tenant's password to a strong random value and prints it once.
 * Run: npx ts-node src/scripts/reset-tenant-password.ts <email>
 */
import 'dotenv/config';
import crypto from 'crypto';
import { query } from '../config/database';
import { hashPassword } from '../utils/auth';

async function resetTenantPassword() {
    const email = process.argv[2];
    if (!email) {
        console.error('Usage: npx ts-node src/scripts/reset-tenant-password.ts <email>');
        process.exit(1);
    }
    const newPassword = crypto.randomBytes(12).toString('base64url');

    try {
        const rows: any = await query('SELECT id FROM tenants WHERE email = ?', [email]);
        if (!rows || rows.length === 0) {
            console.error(`❌ No tenant account found for ${email}`);
            process.exit(1);
        }

        const hash = await hashPassword(newPassword);
        await query('UPDATE tenants SET password_hash = ? WHERE id = ?', [hash, rows[0].id]);

        console.log('✅ Tenant password rotated.');
        console.log(`   Email:    ${email}`);
        console.log(`   Password: ${newPassword}`);
        console.log('   ⚠️ Save it now — it will not be shown again.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed:', err);
        process.exit(1);
    }
}

resetTenantPassword();
