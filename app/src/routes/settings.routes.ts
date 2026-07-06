import express, { Response } from 'express';
import { query } from '../config/database';
import { authenticateJWT, authenticateApiKey, AuthRequest } from '../middleware/auth';

const router = express.Router();

const DEFAULTS = {
    theme_color:   '#4F46E5',
    icon_color:    '#4F46E5',
    modal_size:    'Large',
    icon_position: 'header',
};

// ─── GET /api/tenants/settings  (JWT — dashboard reads settings) ──────────────
router.get('/settings', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const rows: any = await query(
            'SELECT * FROM tenant_settings WHERE tenant_id = ?',
            [req.user.id]
        );
        res.json({ settings: rows.length > 0 ? rows[0] : { tenant_id: req.user.id, ...DEFAULTS } });
    } catch (error) {
        console.error('Settings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// ─── PUT /api/tenants/settings  (JWT — dashboard saves settings) ──────────────
router.put('/settings', authenticateJWT, async (req: AuthRequest, res: Response) => {
    try {
        const { theme_color, icon_color, modal_size, icon_position } = req.body;

        // Lazy migration: Ensure icon_position column can handle new values (Header, etc.)
        // ENUM('Left','Right') was too restrictive and causing truncation errors.
        try {
            await query("ALTER TABLE tenant_settings MODIFY COLUMN icon_position VARCHAR(20) DEFAULT 'header'");
            await query("ALTER TABLE tenant_settings MODIFY COLUMN icon_type VARCHAR(20) DEFAULT 'Icon'");
        } catch (e) {
            // Probably already altered or no permission, ignore
        }

        await query(
            `INSERT INTO tenant_settings (tenant_id, theme_color, icon_color, icon_type, modal_size, icon_position)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               theme_color   = VALUES(theme_color),
               icon_color    = VALUES(icon_color),
               icon_type     = VALUES(icon_type),
               modal_size    = VALUES(modal_size),
               icon_position = VALUES(icon_position),
               updated_at    = NOW()`,
            [
                req.user.id,
                theme_color   || DEFAULTS.theme_color,
                icon_color    || DEFAULTS.icon_color,
                'Icon', // default for backward compatibility with schema
                modal_size    || DEFAULTS.modal_size,
                icon_position || DEFAULTS.icon_position,
            ]
        );

        res.json({ message: 'Settings saved successfully' });
    } catch (error) {
        console.error('Settings save error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// ─── GET /api/tenants/settings/public  (API key — PrestaShop module fetches, server-to-server) ──
// Uses direct api_key lookup without domain verification since this is a
// server-side curl call from the PS module, not a browser request.
router.get('/settings/public', async (req: AuthRequest, res: Response) => {
    try {
        const apiKey      = (req.headers['x-api-key']      as string) || '';
        const apiPassword = (req.headers['x-api-password'] as string) || '';

        if (!apiKey || !apiPassword) {
            return res.status(401).json({ error: 'x-api-key and x-api-password headers required' });
        }

        // Look up tenant by api_key
        const rows: any = await query(
            'SELECT id, api_password_hash FROM tenants WHERE api_key = ? AND status != \'suspended\'',
            [apiKey]
        );

        if (!rows || rows.length === 0) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        const bcrypt = require('bcryptjs');
        const valid = await bcrypt.compare(apiPassword, rows[0].api_password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid API password' });
        }

        const tenantId = rows[0].id;
        const settingRows: any = await query(
            'SELECT theme_color, icon_color, modal_size, icon_position FROM tenant_settings WHERE tenant_id = ?',
            [tenantId]
        );

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.json({ settings: settingRows.length > 0 ? settingRows[0] : DEFAULTS });
    } catch (error) {
        console.error('Public settings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

export default router;
