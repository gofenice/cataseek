import path from 'path';
import fs from 'fs';
import { query } from '../config/database';

// ─── Platform modules (plugin packages) ──────────────────────────────────────
// Downloadable store-integration plugins (PrestaShop, WooCommerce, …) uploaded
// by the super admin and offered to merchants on the Plugins page. One package
// per platform — a new upload replaces the previous one. Zip files live
// outside git in uploads/modules so deploys never clobber them.

export const MODULES_DIR = path.resolve(__dirname, '../../uploads/modules');

let migrated = false;
export async function ensureModuleTables() {
    if (migrated) return;

    fs.mkdirSync(MODULES_DIR, { recursive: true });

    await query(`
        CREATE TABLE IF NOT EXISTS platform_modules (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            platform       VARCHAR(50) NOT NULL,
            name           VARCHAR(150) NOT NULL,
            version        VARCHAR(30) NOT NULL DEFAULT '1.0.0',
            description    VARCHAR(500) NULL,
            filename       VARCHAR(255) NOT NULL,
            original_name  VARCHAR(255) NOT NULL,
            file_size      INT UNSIGNED NOT NULL DEFAULT 0,
            download_count INT UNSIGNED NOT NULL DEFAULT 0,
            is_active      BOOLEAN DEFAULT TRUE,
            created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_platform (platform)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    migrated = true;
}

export function moduleFilePath(filename: string) {
    // filename comes from our own DB, but never allow it to escape the dir
    const resolved = path.resolve(MODULES_DIR, filename);
    if (!resolved.startsWith(MODULES_DIR)) throw new Error('Invalid module filename');
    return resolved;
}

export function removeModuleFile(filename: string) {
    try {
        const p = moduleFilePath(filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
        console.error('Failed to remove module file:', e);
    }
}
