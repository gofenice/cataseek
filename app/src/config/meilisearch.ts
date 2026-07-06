import { MeiliSearch } from 'meilisearch';
import dotenv from 'dotenv';

dotenv.config();

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_API_KEY || process.env.MEILISEARCH_KEY
});

export const createTenantIndex = async (indexName: string) => {
  try {
    const index = await client.createIndex(indexName, { primaryKey: 'id' });

    // Configure searchable attributes
    await client.index(indexName).updateSearchableAttributes([
      'name',
      'description',
      'categories',
      'sku',
      'attributes'
    ]);

    // Configure filterable attributes for multi-language and multi-store
    await client.index(indexName).updateFilterableAttributes([
      'language',
      'store_id',
      'status',
      'price',
      'quantity',
      'categories',
      'hidden'       // used by the dashboard hide/show feature
    ]);

    // Configure sortable attributes
    await client.index(indexName).updateSortableAttributes([
      'price',
      'created_at',
      'name'
    ]);

    // Configure ranking rules for better search results
    await client.index(indexName).updateRankingRules([
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness'
    ]);

    return index;
  } catch (error: any) {
    if (error.code === 'index_already_exists') {
      return client.index(indexName);
    }
    throw error;
  }
};

/**
 * Patch filterable attributes on an existing tenant index.
 * Called lazily by toggle-visibility so live indexes already deployed get updated.
 */
export const updateTenantFilterableAttributes = async (indexName: string) => {
  try {
    await client.index(indexName).updateFilterableAttributes([
      'language',
      'store_id',
      'status',
      'price',
      'quantity',
      'categories',
      'hidden'
    ]);
  } catch (_) {
    // Non-fatal — search still works without the attribute being filterable
  }
};


export const deleteTenantIndex = async (indexName: string) => {
  try {
    await client.deleteIndex(indexName);
  } catch (error: any) {
    if (error.code !== 'index_not_found') {
      throw error;
    }
  }
};

export const indexProducts = async (indexName: string, products: any[]) => {
  const index = client.index(indexName);
  return await index.addDocuments(products);
};

export const updateProducts = async (indexName: string, products: any[]) => {
  const index = client.index(indexName);
  return await index.updateDocuments(products);
};

export const deleteProducts = async (indexName: string, productIds: string[]) => {
  const index = client.index(indexName);
  return await index.deleteDocuments(productIds);
};

export const searchProducts = async (
  indexName: string,
  query: string,
  filters?: {
    language?: string;
    storeId?: string;
    categories?: string[];
    minPrice?: number;
    maxPrice?: number;
  },
  options?: {
    limit?: number;
    offset?: number;
    sort?: string[];
    facets?: string[];
  }
) => {
  const index = client.index(indexName);

  let filterString = 'status = "active"';

  if (filters?.language) {
    filterString += ` AND language = "${filters.language}"`;
  }

  if (filters?.storeId) {
    if (filters.storeId === '1') {
      filterString += ` AND (store_id = "1" OR store_id = "default")`;
    } else {
      filterString += ` AND store_id = "${filters.storeId}"`;
    }
  }

  if (filters?.categories && filters.categories.length > 0) {
    const categoryFilter = filters.categories.map(c => `categories = "${c}"`).join(' OR ');
    filterString += ` AND (${categoryFilter})`;
  }

  if (filters?.minPrice !== undefined) {
    filterString += ` AND price >= ${filters.minPrice}`;
  }

  if (filters?.maxPrice !== undefined) {
    filterString += ` AND price <= ${filters.maxPrice}`;
  }



  return await index.search(query, {
    filter: filterString,
    limit: options?.limit || 20,
    offset: options?.offset || 0,
    sort: options?.sort,
    facets: options?.facets
  });
};

export default client;