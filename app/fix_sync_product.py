"""
Fix: rewrite syncProduct() in cataseek.php to sync ALL active languages
instead of only the current admin panel language, preventing duplicate
Meilisearch documents when admin switches language before editing a product.
"""
fpath = 'plugins/prestashop/cataseek/cataseek.php'

with open(fpath, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the syncProduct method and replace it
import re

old_method_pattern = r"    /\*\*\s*\n\s+\* Sync single product to Cataseek API\s*\n\s+\*/\s*\n\s+public function syncProduct\(\$productId\).*?^    \}\n"
new_method = '''    /**
     * Sync single product to Cataseek API (across ALL active languages)
     * This prevents duplicate Meilisearch documents when the admin panel language changes.
     */
    public function syncProduct($productId)
    {
        if (!Configuration::get('CATASEEK_LIVE_MODE')) {
            return false;
        }

        $apiUrl      = Configuration::get('CATASEEK_API_URL');
        $apiKey      = Configuration::get('CATASEEK_API_KEY');
        $apiPassword = Configuration::get('CATASEEK_API_PASSWORD');

        if (!$apiUrl || !$apiKey || !$apiPassword) {
            return false;
        }

        $storeId  = (string) $this->context->shop->id;
        $products = array();

        // Loop ALL active languages so the compound ID (external_id_lang_store) stays
        // stable regardless of which language the admin panel is using at save time.
        foreach (Language::getLanguages(true) as $lang) {
            $langId  = (int) $lang['id_lang'];
            $product = new Product($productId, true, $langId);

            if (!Validate::isLoadedObject($product)) {
                continue;
            }

            $categories = array();
            foreach ($product->getCategories() as $catId) {
                $category = new Category($catId, $langId);
                if (Validate::isLoadedObject($category)) {
                    $categories[] = $category->name;
                }
            }

            $images = array();
            foreach ($product->getImages($langId) as $image) {
                $images[] = $this->context->link->getImageLink(
                    $product->link_rewrite,
                    $image['id_image'],
                    'large_default'
                );
            }

            $products[] = array(
                'external_id'   => (string) $product->id,
                'name'          => $product->name,
                'description'   => strip_tags($product->description_short),
                'price'         => (float) $product->getPrice(),
                'compare_price' => (float) $product->getPriceWithoutReduct(true),
                'quantity'      => (int) StockAvailable::getQuantityAvailableByProduct($product->id),
                'sku'           => $product->reference,
                'categories'    => $categories,
                'images'        => $images,
                'status'        => $product->active ? 'active' : 'inactive',
                'language'      => $lang['iso_code'],
                'store_id'      => $storeId,
                'url'           => $this->context->link->getProductLink($product, null, null, null, $langId),
            );
        }

        if (empty($products)) {
            return false;
        }

        return $this->makeApiRequest('/products/sync', array('products' => $products));
    }

'''

match = re.search(
    r'    /\*\*\s*\n\s+\* Sync single product to Cataseek API\s*\n\s+\*/\s*\n\s+public function syncProduct\(\$productId\).*?\n    \}\n',
    content,
    re.DOTALL
)

if match:
    content = content[:match.start()] + new_method + content[match.end():]
    with open(fpath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: syncProduct() has been rewritten to sync all active languages.")
else:
    print("ERROR: Could not find the syncProduct method. Check the file manually.")
    # Show surrounding context
    idx = content.find('public function syncProduct')
    if idx >= 0:
        print("Found syncProduct at char", idx)
        print(repr(content[idx-50:idx+200]))
