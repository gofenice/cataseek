import express, { Response } from 'express';
import fs from 'fs';
import { query } from '../config/database';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { moduleFilePath } from '../services/modules.service';

const router = express.Router();

// Merchant-facing: list and download the plugin packages published by the admin
router.use(authenticateJWT);

// ─── GET /api/modules ────────────────────────────────────────────────────────
// Active plugin packages, one per platform
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const modules: any = await query(`
            SELECT id, platform, name, version, description, original_name, file_size, updated_at
            FROM platform_modules
            WHERE is_active = TRUE
            ORDER BY platform
        `);
        res.json({ modules });
    } catch (error) {
        console.error('List modules error:', error);
        res.status(500).json({ error: 'Failed to fetch modules' });
    }
});

// ─── GET /api/modules/:id/download ───────────────────────────────────────────
router.get('/:id/download', async (req: AuthRequest, res: Response) => {
    try {
        const rows: any = await query(
            'SELECT * FROM platform_modules WHERE id = ? AND is_active = TRUE',
            [req.params.id]
        );
        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Module not found' });
        }

        const mod = rows[0];
        const filePath = moduleFilePath(mod.filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Module file missing — contact support' });
        }

        await query('UPDATE platform_modules SET download_count = download_count + 1 WHERE id = ?', [mod.id]);
        res.download(filePath, mod.original_name);
    } catch (error) {
        console.error('Download module error:', error);
        res.status(500).json({ error: 'Failed to download module' });
    }
});

export default router;
