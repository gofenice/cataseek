import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query, getConnection } from '../config/database';
import { indexProducts, updateProducts, deleteProducts, searchProducts, updateTenantFilterableAttributes, deleteTenantIndex, createTenantIndex } from '../config/meilisearch';
import { authenticateApiKey, authenticatePublicSearch, checkPlanLimits, AuthRequest, authenticateJWT } from '../middleware/auth';
import { RowDataPacket } from 'mysql2';

const router = express.Router();

// Track API usage
const trackUsage = async (tenantId: number, endpoint: string) => {
  const today = new Date().toISOString().split('T')[0];
  await query(
    `INSERT INTO api_usage (tenant_id, endpoint, date, request_count) 
     VALUES (?, ?, ?, 1) 
     ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
    [tenantId, endpoint, today]
  );
};

// Sync products (batch insert/update)
router.post(
  '/sync',
  authenticateApiKey,
  checkPlanLimits,
  [
    body('products').isArray({ min: 1 }).withMessage('Products array is required')
  ],
  async (req: AuthRequest, res: Response) => {
    const connection = await getConnection();

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { products } = req.body;
      const tenantId = req.tenant.id;
      const tableName = `products_${tenantId}`;
      const indexName = req.tenant.meilisearch_index_name;

      await trackUsage(tenantId, '/products/sync');

      // Lazy migration: add url column if it doesn't exist yet (runs fast after first time)
      try {
        await query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS url TEXT DEFAULT NULL`);
      } catch (e) { /* column already exists or no ALTER privilege — ignore */ }

      // Check product count limit
      const countResult: any = await query(
        `SELECT COUNT(DISTINCT external_id) as count FROM ${tableName}`
      );

      const currentCount = countResult[0].count;

      // Figure out how many of the incoming products are genuinely new
      // (Check which IDs already exist so updates don't count against the limit)
      const incomingExternalIds = Array.from(new Set(
        products
          .filter((p: any) => p.external_id)
          .map((p: any) => String(p.external_id))
      )) as string[];

      let newCount = 0;
      if (incomingExternalIds.length > 0) {
        const placeholders = incomingExternalIds.map(() => '?').join(',');
        const existingRows: any = await query(
          `SELECT DISTINCT external_id FROM ${tableName} WHERE external_id IN (${placeholders})`,
          incomingExternalIds
        );
        const existingSet = new Set(existingRows.map((r: any) => String(r.external_id)));
        newCount = incomingExternalIds.filter((extId: string) => !existingSet.has(extId)).length;
      }

      if (currentCount + newCount > req.tenant.maxProducts) {
        return res.status(403).json({
          error: `Product limit exceeded. Your plan allows ${req.tenant.maxProducts} products. Current: ${currentCount}, Attempting to add: ${newCount} new products.`
        });
      }


      await connection.beginTransaction();

      const processedProducts = [];
      const insertedProducts = [];
      const updatedProducts = [];
      const skippedProducts = [];

      for (const product of products) {
        try {
          // Validate required fields
          if (!product.external_id || !product.name) {
            console.warn(`[Tenant ${tenantId}] Skipping product - missing required fields:`, {
              external_id: product.external_id,
              name: product.name
            });
            skippedProducts.push({
              product: product.external_id || 'unknown',
              reason: 'Missing required fields (external_id or name)'
            });
            continue;
          }

          const {
            external_id,
            name,
            description = '',
            price = 0,
            compare_price = null,
            quantity = 0,
            sku = '',
            categories = [],
            attributes = {},
            images = [],
            language = 'en',
            store_id = 'default',
            status = 'active',
            url = ''
          } = product;

          // Generate unique ID combining external_id, language, and store_id for multi-language/multi-store support
          const id = `${external_id}_${language}_${store_id}`;

          // Check if product exists
          const [existing] = await connection.execute(
            `SELECT id FROM ${tableName} WHERE id = ?`,
            [id]
          );

          const categoriesJson = JSON.stringify(categories);
          const attributesJson = JSON.stringify(attributes);
          const imagesJson = JSON.stringify(images);

          if ((existing as RowDataPacket[]).length > 0) {
            // Update existing product
            await connection.execute(
              `UPDATE ${tableName} 
               SET name = ?, description = ?, price = ?, compare_price = ?, 
                   quantity = ?, sku = ?, categories = ?, attributes = ?, 
                   images = ?, url = ?, status = ?, updated_at = NOW()
               WHERE id = ?`,
              [name, description, price, compare_price, quantity, sku,
                categoriesJson, attributesJson, imagesJson, url || '', status, id]
            );
            updatedProducts.push(id);
          } else {
            // Insert new product
            await connection.execute(
              `INSERT INTO ${tableName} 
               (id, external_id, name, description, price, compare_price, quantity, 
                sku, categories, attributes, images, url, language, store_id, status) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [id, external_id, name, description, price, compare_price, quantity,
                sku, categoriesJson, attributesJson, imagesJson, url || '', language, store_id, status]
            );
            insertedProducts.push(id);
          }

          // Only index active products with valid data
          if (status === 'active') {
            processedProducts.push({
              id,
              external_id,
              name,
              description,
              price: parseFloat(price) || 0,
              compare_price: compare_price ? parseFloat(compare_price) : null,
              quantity: parseInt(quantity) || 0,
              sku,
              categories,
              attributes,
              images,
              url: url || '',
              language,
              store_id,
              status,
              created_at: Date.now()
            });
          }
        } catch (productError: any) {
          // Log error but continue processing other products
          console.error(`[Tenant ${tenantId}] Error processing product:`, {
            external_id: product.external_id,
            error: productError.message
          });
          skippedProducts.push({
            product: product.external_id || 'unknown',
            reason: productError.message
          });
        }
      }


      await connection.commit();

      // Index products in Meilisearch
      if (processedProducts.length > 0) {
        await indexProducts(indexName, processedProducts);
      }

      res.json({
        message: 'Products synced successfully',
        stats: {
          total: products.length,
          inserted: insertedProducts.length,
          updated: updatedProducts.length,
          skipped: skippedProducts.length
        },
        skipped: skippedProducts.length > 0 ? skippedProducts : undefined
      });
    } catch (error) {
      await connection.rollback();
      console.error('Product sync error:', error);
      res.status(500).json({ error: 'Failed to sync products' });
    } finally {
      connection.release();
    }
  }
);

// Delete products
router.post(
  '/delete',
  authenticateApiKey,
  checkPlanLimits,
  [
    body('product_ids').isArray({ min: 1 }).withMessage('Product IDs array is required')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { product_ids } = req.body;
      const tenantId = req.tenant.id;
      const tableName = `products_${tenantId}`;
      const indexName = req.tenant.meilisearch_index_name;

      await trackUsage(tenantId, '/products/delete');

      // Delete from database
      const placeholders = product_ids.map(() => '?').join(',');
      await query(
        `DELETE FROM ${tableName} WHERE id IN (${placeholders})`,
        product_ids
      );

      // Delete from Meilisearch
      await deleteProducts(indexName, product_ids);

      res.json({
        message: 'Products deleted successfully',
        count: product_ids.length
      });
    } catch (error) {
      console.error('Product deletion error:', error);
      res.status(500).json({ error: 'Failed to delete products' });
    }
  }
);

// Public Search (No password required, strict domain check)
router.post(
  '/public/search',
  authenticatePublicSearch,
  checkPlanLimits,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        query: searchQuery = '',
        language,
        store_id,
        categories,
        min_price,
        max_price,
        limit = 10,
        offset = 0,
        sort = [],
        facets = ['categories', 'price']
      } = req.body;

      const tenantId = req.tenant.id;
      const indexName = req.tenant.meilisearch_index_name;

      trackUsage(tenantId, '/products/public/search').catch(console.error); // fire-and-forget: don't block Meilisearch

      const results = await searchProducts(
        indexName,
        searchQuery,
        {
          language,
          storeId: store_id,
          categories,
          minPrice: min_price,
          maxPrice: max_price
        },
        {
          limit,
          offset,
          sort,
          facets
        }
      );

      // ── Search Analytics logging (fire-and-forget, never delays the response) ──
      // Only log queries with 3+ characters (skip single-character keystroke fragments).
      // Dedup: delete any entry from the same tenant in the last 10 seconds before inserting.
      // This way rapid keystrokes (h → ho → hom → home) overwrite each other and only
      // the final completed query ("home") survives in the analytics.
      if (searchQuery && searchQuery.trim().length >= 3) {
        const hitCount = results.hits?.length ?? 0;
        const trimmedQuery = searchQuery.trim().toLowerCase();
        // Lazy table creation + dedup delete + insert — all silent on error
        query(
          `CREATE TABLE IF NOT EXISTS search_analytics (
            id           BIGINT AUTO_INCREMENT PRIMARY KEY,
            tenant_id    INT NOT NULL,
            query        VARCHAR(500) NOT NULL,
            result_count INT NOT NULL DEFAULT 0,
            language     VARCHAR(10)  DEFAULT 'en',
            searched_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_tenant_date  (tenant_id, searched_at),
            INDEX idx_tenant_query (tenant_id, query(100)),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        )
          .then(() =>
            // Delete any recent entry from the same tenant within the last 10 seconds
            // (keystroke dedup — the new query replaces the intermediate ones)
            query(
              `DELETE FROM search_analytics
               WHERE tenant_id = ? AND searched_at >= NOW() - INTERVAL 10 SECOND`,
              [tenantId]
            )
          )
          .then(() =>
            query(
              `INSERT INTO search_analytics (tenant_id, query, result_count, language)
               VALUES (?, ?, ?, ?)`,
              [tenantId, trimmedQuery, hitCount, language || 'en']
            )
          )
          .catch(() => { }); // silently swallow — analytics must never affect search
      }

      res.json({
        results: results.hits,
        total: results.estimatedTotalHits,
        facetDistribution: results.facetDistribution,
        facetStats: results.facetStats,
        processingTime: results.processingTimeMs,
        limit,
        offset
      });
    } catch (error) {
      console.error('Public search error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  }
);

// Search products
router.post(
  '/search',
  authenticateApiKey,
  checkPlanLimits,
  async (req: AuthRequest, res) => {
    try {
      const {
        query: searchQuery = '',
        language,
        store_id,
        categories,
        min_price,
        max_price,
        limit = 20,
        offset = 0,
        sort = []
      } = req.body;

      const tenantId = req.tenant.id;
      const indexName = req.tenant.meilisearch_index_name;

      await trackUsage(tenantId, '/products/search');

      const results = await searchProducts(
        indexName,
        searchQuery,
        {
          language,
          storeId: store_id,
          categories,
          minPrice: min_price,
          maxPrice: max_price
        },
        {
          limit,
          offset,
          sort
        }
      );

      res.json({
        query: searchQuery,
        results: results.hits,
        total: results.estimatedTotalHits,
        limit,
        offset,
        processingTime: results.processingTimeMs
      });
    } catch (error) {
      console.error('Product search error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  }
);

// Get product statistics
router.get('/stats', authenticateApiKey, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.tenant.id;
    const tableName = `products_${tenantId}`;

    const stats: any = await query(
      `SELECT 
        COUNT(*) as total_products,
        COUNT(DISTINCT language) as languages,
        COUNT(DISTINCT store_id) as stores,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_products,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive_products
       FROM ${tableName}`
    );

    res.json({ stats: stats[0] });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get available languages
router.get('/languages', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.user.id;
    const tableName = `products_${tenantId}`;

    const rows: any = await query(
      `SELECT DISTINCT language FROM ${tableName} ORDER BY language ASC`
    );

    res.json({ languages: rows.map((r: any) => r.language) });
  } catch (error) {
    console.error('Languages fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch languages' });
  }
});

// Get paginated products for the dashboard catalogue
router.get('/', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.user.id;
    const tableName = `products_${tenantId}`;

    // Lazy migration: add hidden column if it doesn't exist yet
    try {
      await query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS hidden TINYINT(1) NOT NULL DEFAULT 0`);
    } catch (_) { /* column already exists or no ALTER privilege */ }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;
    const language = req.query.language as string;
    const search = (req.query.search as string || '').trim();
    const showHidden = req.query.show_hidden === 'true';

    const conditions: string[] = [];
    const queryParams: any[] = [];

    if (language) {
      conditions.push('language = ?');
      queryParams.push(language);
    }

    if (!showHidden) {
      conditions.push('hidden = 0');
    }

    if (search) {
      conditions.push('(name LIKE ? OR sku LIKE ? OR external_id LIKE ?)');
      const likeTerm = `%${search}%`;
      queryParams.push(likeTerm, likeTerm, likeTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult: any = await query(
      `SELECT COUNT(*) as total FROM ${tableName} ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // Get paginated data
    const paginatedParams = [...queryParams, limit, offset];
    const products: any = await query(
      `SELECT * FROM ${tableName} ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      paginatedParams
    );

    const tenant: any = await query('SELECT store_domain FROM tenants WHERE id = ?', [tenantId]);
    const storeDomain = tenant[0]?.store_domain || '';

    res.json({
      products,
      storeDomain,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Products fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Toggle product visibility (hide/show from Meilisearch)
router.post('/toggle-visibility', authenticateJWT, async (req: AuthRequest, res) => {
  try {
    const tenantId = req.user.id;
    const tableName = `products_${tenantId}`;
    const indexName = req.user.meilisearch_index_name;
    const { product_id, hidden } = req.body;

    if (!product_id || typeof hidden !== 'boolean') {
      return res.status(400).json({ error: 'product_id (string) and hidden (boolean) are required' });
    }

    // 1. Update hidden flag in MySQL
    await query(
      `UPDATE ${tableName} SET hidden = ?, updated_at = NOW() WHERE id = ?`,
      [hidden ? 1 : 0, product_id]
    );

    if (hidden) {
      // 2a. Remove from Meilisearch so it vanishes from search immediately
      await deleteProducts(indexName, [product_id]);
    } else {
      // 2b. Re-fetch from MySQL and restore to Meilisearch
      const rows: any = await query(`SELECT * FROM ${tableName} WHERE id = ?`, [product_id]);
      if (rows && rows.length > 0) {
        const p = rows[0];
        const doc = {
          id: p.id,
          external_id: p.external_id,
          name: p.name,
          description: p.description,
          price: parseFloat(p.price) || 0,
          compare_price: p.compare_price ? parseFloat(p.compare_price) : null,
          quantity: parseInt(p.quantity) || 0,
          sku: p.sku,
          categories: typeof p.categories === 'string' ? JSON.parse(p.categories) : (p.categories || []),
          attributes: typeof p.attributes === 'string' ? JSON.parse(p.attributes) : (p.attributes || {}),
          images: typeof p.images === 'string' ? JSON.parse(p.images) : (p.images || []),
          url: p.url || '',
          language: p.language,
          store_id: p.store_id,
          status: p.status,
          hidden: 0,
          created_at: p.created_at ? new Date(p.created_at).getTime() : Date.now()
        };

        // Only restore if product is active
        if (doc.status === 'active') {
          await indexProducts(indexName, [doc]);
        }
      }
    }

    // Lazy: ensure 'hidden' is in filterableAttributes so Meilisearch can use it
    updateTenantFilterableAttributes(indexName).catch(() => { });

    res.json({ success: true, product_id, hidden });
  } catch (error) {
    console.error('Toggle visibility error:', error);
    res.status(500).json({ error: 'Failed to toggle product visibility' });
  }
});
// Reset the entire product database and search index for the tenant
router.post('/reset-index', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user.id;
    const tableName = `products_${tenantId}`;
    const indexName = req.user.meilisearch_index_name;

    // 1. Truncate the MySQL products table for this tenant
    await query(`TRUNCATE TABLE ${tableName}`);

    // 2. Delete and recreate the Meilisearch index (wipes all cached documents and resets settings)
    try {
      await deleteTenantIndex(indexName);
    } catch (e) {
      console.log(`[Reset Index] Index ${indexName} might not exist yet, skipping delete.`);
    }
    await createTenantIndex(indexName);

    res.json({ message: 'Search index and product database successfully reset. Please run a Full Sync from your store.' });
  } catch (error) {
    console.error('Reset index error:', error);
    res.status(500).json({ error: 'Failed to reset search index' });
  }
});

export default router;
