<?php
/**
 * Cataseek - AI-Powered Search SaaS for PrestaShop
 *
 * @author    gofenice
 * @copyright 2026 gofenice
 * @license   Commercial
 * @version   1.0.0
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class Cataseek extends Module
{
    protected $config_form = false;

    public function __construct()
    {
        $this->name = 'cataseek';
        $this->tab = 'search_filter';
        $this->version = '1.0.0';
        $this->author = 'gofenice';
        $this->need_instance = 0;
        $this->bootstrap = true;

        parent::__construct();

        $this->displayName = $this->l('Cataseek Search');
        $this->description = $this->l('Powerful search engine that understands your customers intent.');
        $this->ps_versions_compliancy = array('min' => '1.7.0.0', 'max' => '9.99.99');
    }

    /**
     * Module installation
     */
    public function install()
    {
        // Default configuration values
        Configuration::updateValue('CATASEEK_LIVE_MODE', false);
        Configuration::updateValue('CATASEEK_API_URL', 'https://phpstack-1469939-5553288.cloudwaysapps.com/api');

        return parent::install() &&
            $this->installTab() &&
            $this->registerHook('displayHeader') &&
            $this->registerHook('displayTop') &&
            $this->registerHook('displayFooter') &&
            $this->registerHook('actionObjectProductUpdateAfter') &&
            $this->registerHook('actionObjectProductAddAfter') &&
            $this->registerHook('actionObjectProductDeleteAfter');
    }

    /**
     * Module uninstallation
     */
    public function uninstall()
    {
        Configuration::deleteByName('CATASEEK_LIVE_MODE');
        Configuration::deleteByName('CATASEEK_API_URL');
        Configuration::deleteByName('CATASEEK_API_KEY');
        Configuration::deleteByName('CATASEEK_API_PASSWORD');
        Configuration::deleteByName('CATASEEK_SELECTOR');
        Configuration::deleteByName('CATASEEK_CACHED_SETTINGS');
        Configuration::deleteByName('CATASEEK_SETTINGS_CACHED_AT');

        return parent::uninstall() && $this->uninstallTab();
    }

    /**
     * Install admin tab for AJAX controller
     */
    public function installTab()
    {
        $tab = new Tab();
        $tab->active = 1;
        $tab->class_name = 'AdminCataseekSync';
        $tab->name = array();
        foreach (Language::getLanguages(true) as $lang) {
            $tab->name[$lang['id_lang']] = 'Cataseek Sync';
        }
        $tab->id_parent = -1; // Hidden tab
        $tab->module = $this->name;

        return $tab->add();
    }

    /**
     * Uninstall admin tab
     */
    public function uninstallTab()
    {
        $id_tab = (int) Tab::getIdFromClassName('AdminCataseekSync');
        if ($id_tab) {
            $tab = new Tab($id_tab);
            return $tab->delete();
        }
        return true;
    }

    /**
     * Load the configuration form
     */
    public function getContent()
    {
        if (!$this->isRegisteredInHook('displayFooter')) {
            $this->registerHook('displayFooter');
        }

        $output = '';

        if (Tools::isSubmit('submitCataseekRefreshSettings')) {
            // Force refresh — bypass cache and hit the API immediately
            $settings = $this->getCataseekSettings(true);
            if ($settings !== false) {
                $output .= $this->displayConfirmation(
                    $this->l('Design settings refreshed successfully from your Cataseek Dashboard!')
                );
            } else {
                $output .= $this->displayWarning(
                    $this->l('Could not fetch settings from the Cataseek API. Check your API Key and Password, then check PS Logs for details.')
                );
            }
        }

        if (Tools::isSubmit('submitCataseekModule')) {
            $this->postProcess();
            $output .= $this->displayConfirmation($this->l('Settings updated successfully'));
        }

        // Detect the real scheme (Cloudways terminates HTTPS at the load balancer,
        // so getAdminLink always returns http:// even when the browser is on https://).
        // We read X-Forwarded-Proto first, then fall back to the HTTPS server var.
        $isHttps = (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')
                   || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');

        $ajaxUrl = $this->context->link->getAdminLink('AdminCataseekSync');
        if ($isHttps) {
            $ajaxUrl = str_replace('http://', 'https://', $ajaxUrl);
        }

        $formHtml = $this->renderForm();

        $this->context->smarty->assign(array(
            'module_dir' => $this->_path,
            'ajax_url' => $ajaxUrl,
            'form_html' => $formHtml,
        ));

        $output .= $this->context->smarty->fetch($this->local_path . 'views/templates/admin/configure.tpl');

        return $output;
    }

    /**
     * Create the configuration form
     */
    protected function renderForm()
    {
        $helper = new HelperForm();

        $helper->show_toolbar = false;
        $helper->table = $this->table;
        $helper->module = $this;
        $helper->default_form_language = $this->context->language->id;
        $helper->allow_employee_form_lang = Configuration::get('PS_BO_ALLOW_EMPLOYEE_FORM_LANG', 0);

        $helper->identifier = $this->identifier;
        $helper->submit_action = 'submitCataseekModule';
        $currentIndex = $this->context->link->getAdminLink('AdminModules', false)
            . '&configure=' . $this->name . '&tab_module=' . $this->tab . '&module_name=' . $this->name;
        // Apply the same scheme fix so the form action doesn't trigger the
        // 'information you are submitting is not secure' browser warning.
        if ($isHttps ?? false) {
            $currentIndex = str_replace('http://', 'https://', $currentIndex);
        }
        $helper->currentIndex = $currentIndex;
        $helper->token = Tools::getAdminTokenLite('AdminModules');

        $helper->tpl_vars = array(
            'fields_value' => $this->getConfigFormValues(),
            'languages' => $this->context->controller->getLanguages(),
            'id_language' => $this->context->language->id,
        );

        return $helper->generateForm(array($this->getConfigForm()));
    }

    /**
     * Create the form structure
     */
    protected function getConfigForm()
    {
        return array(
            'form' => array(
                'legend' => array(
                    'title' => $this->l('Cataseek AI Search Configuration'),
                    'icon' => 'icon-cogs',
                ),
                'input' => array(
                    // API Settings Section
                    array(
                        'type' => 'html',
                        'name' => '',
                        'html_content' => '<h3>' . $this->l('API Settings') . '</h3><hr>',
                    ),
                    array(
                        'type' => 'switch',
                        'label' => $this->l('Live mode'),
                        'name' => 'CATASEEK_LIVE_MODE',
                        'is_bool' => true,
                        'desc' => $this->l('Enable this to start syncing products to Cataseek'),
                        'values' => array(
                            array(
                                'id' => 'active_on',
                                'value' => true,
                                'label' => $this->l('Enabled')
                            ),
                            array(
                                'id' => 'active_off',
                                'value' => false,
                                'label' => $this->l('Disabled')
                            )
                        ),
                    ),
                    array(
                        'col' => 6,
                        'type' => 'hidden',
                        'prefix' => '<i class="icon icon-link"></i>',
                        'desc' => $this->l('The URL of your Cataseek API instance'),
                        'name' => 'CATASEEK_API_URL',
                        'label' => $this->l('API URL'),
                        'required' => true,
                    ),
                    array(
                        'col' => 6,
                        'type' => 'text',
                        'prefix' => '<i class="icon icon-key"></i>',
                        'name' => 'CATASEEK_API_KEY',
                        'label' => $this->l('API Key'),
                        'required' => true,
                    ),
                    array(
                        'col' => 4,
                        'type' => 'password',
                        'prefix' => '<i class="icon icon-lock"></i>',
                        'name' => 'CATASEEK_API_PASSWORD',
                        'label' => $this->l('API Password'),
                        'required' => true,
                    ),
                    // Search selector override
                    array(
                        'col' => 6,
                        'type' => 'text',
                        'label' => $this->l('Search Input Selector'),
                        'name' => 'CATASEEK_SELECTOR',
                        'desc' => $this->l('CSS selector for the search input to override. Leave empty for defaults.'),
                    ),
                    // Design settings refresh
                    array(
                        'type' => 'free',
                        'label' => $this->l('Design Settings'),
                        'name' => 'CATASEEK_DESIGN_SETTINGS_HTML',
                    ),
                ),
                'submit' => array(
                    'title' => $this->l('Save Settings'),
                ),
            ),
        );
    }

    /**
     * Get configuration values
     */
    protected function getConfigFormValues()
    {
        return array(
            'CATASEEK_LIVE_MODE' => Configuration::get('CATASEEK_LIVE_MODE', false),
            'CATASEEK_API_URL' => Configuration::get('CATASEEK_API_URL', 'https://phpstack-1469939-5553288.cloudwaysapps.com/api'),
            'CATASEEK_API_KEY' => Configuration::get('CATASEEK_API_KEY', null),
            'CATASEEK_API_PASSWORD' => '', // Don't show password for security
            'CATASEEK_SELECTOR' => Configuration::get('CATASEEK_SELECTOR', '#search_widget input, input[name="s"], input[name="search_query"]'),
            'CATASEEK_DESIGN_SETTINGS_HTML' =>
                '<p class="help-block" style="margin-top:0;">'
                . $this->l('Colors, icon type, modal size and position are managed in your') . ' '
                . '<strong><a href="https://phpstack-1469939-5553288.cloudwaysapps.com/settings" target="_blank">' . $this->l('Cataseek Dashboard Settings') . '</a></strong>.</p>'
                . '<a href="' . $this->context->link->getAdminLink('AdminModules', true) . '&configure=' . $this->name . '&tab_module=' . $this->tab . '&module_name=' . $this->name . '&submitCataseekRefreshSettings=1" class="btn btn-default" style="margin-top: 5px;"><i class="icon-refresh"></i> ' . $this->l('Refresh Settings from Dashboard') . '</a>',
        );
    }

    /**
     * Fetch design settings from the Cataseek SaaS API.
     * Results are cached in PS Configuration for 1 hour to avoid an API call on every page load.
     */
    private function getCataseekSettings($forceRefresh = false)
    {
        $defaults = array(
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        );

        $cachedAt = (int) Configuration::get('CATASEEK_SETTINGS_CACHED_AT', 0);
        $cacheAge = time() - $cachedAt;

        // Use cache (skip if forcing a refresh)
        if (!$forceRefresh && $cacheAge < 3600) {
            $cached = Configuration::get('CATASEEK_CACHED_SETTINGS', '');
            if ($cached) {
                $decoded = json_decode($cached, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }

        // Fetch fresh settings from SaaS API
        $apiUrl = rtrim(Configuration::get('CATASEEK_API_URL', 'https://phpstack-1469939-5553288.cloudwaysapps.com/api'), '/');
        $apiKey = Configuration::get('CATASEEK_API_KEY', '');
        $apiPass = Configuration::get('CATASEEK_API_PASSWORD', '');

        if (empty($apiKey) || empty($apiPass)) {
            return $defaults;
        }

        // Append cache-buster timestamp to bypass Cloudways Varnish/Nginx cache
        $cacheBuster = '?t=' . time();
        $ch = curl_init($apiUrl . '/tenants/settings/public' . $cacheBuster);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false, // server-to-server, skip cert verify
            CURLOPT_HTTPHEADER => array(
                'X-Api-Key: ' . $apiKey,
                'X-Api-Password: ' . $apiPass,
                'Content-Type: application/json',
            ),
        ));
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($httpCode === 200 && $response) {
            $data = json_decode($response, true);
            if (isset($data['settings']) && is_array($data['settings'])) {
                $settings = array_merge($defaults, $data['settings']);
                Configuration::updateValue('CATASEEK_CACHED_SETTINGS', json_encode($settings));
                Configuration::updateValue('CATASEEK_SETTINGS_CACHED_AT', time());
                return $settings;
            }
        }

        // Log failure — but only once per hour to avoid flooding PS logs
        $lastLog = (int) Configuration::get('CATASEEK_LAST_LOG_AT', 0);
        if ((time() - $lastLog) > 3600) {
            Configuration::updateValue('CATASEEK_LAST_LOG_AT', time());
            $logMsg = '[Cataseek] Settings fetch FAILED.';
            $logMsg .= ' HTTP code: ' . $httpCode;
            $logMsg .= ' | cURL error: ' . ($curlErr ?: 'none');
            $logMsg .= ' | API URL: ' . $apiUrl . '/tenants/settings/public';
            $logMsg .= ' | Response: ' . substr((string) $response, 0, 300);
            PrestaShopLogger::addLog($logMsg, 2, null);
        }

        return false; // explicit false so callers know the API call failed
    }

    /**
     * Save form data
     */
    protected function postProcess()
    {
        $form_values = $this->getConfigFormValues();

        foreach (array_keys($form_values) as $key) {
            $value = Tools::getValue($key);

            // Only update password if a new one is provided
            if ($key === 'CATASEEK_API_PASSWORD' && empty($value)) {
                continue;
            }

            Configuration::updateValue($key, $value);
        }
    }

    /**
     * Hook: displayHeader - Load CSS and JS
     */
    /**
     * Hook: displayHeader - Load CSS and JS
     */
    public function hookDisplayHeader()
    {
        $this->context->controller->registerStylesheet(
            'module-cataseek-style',
            'modules/' . $this->name . '/views/css/cataseek-front.css',
            ['media' => 'all', 'priority' => 150]
        );

        $this->context->controller->registerJavascript(
            'module-cataseek-js',
            'modules/' . $this->name . '/views/js/cataseek-front.js',
            ['position' => 'bottom', 'priority' => 150]
        );

        // Fetch design settings once (cached in PS DB for 1 hour; fallback to defaults on API failure)
        $designSettings = $this->getCataseekSettings() ?: array(
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        );

        Media::addJsDef([
            'cataseekConfig' => [
                'apiUrl' => Configuration::get('CATASEEK_API_URL'),
                'apiKey' => Configuration::get('CATASEEK_API_KEY'),
                'selector' => Configuration::get('CATASEEK_SELECTOR', '#search_widget input, input[name="s"], input[name="search_query"]'),
                'color' => $designSettings['theme_color'],
                'iconColor' => $designSettings['icon_color'],
                'modalSize' => $designSettings['modal_size'],
                'minChars' => 2,
                'shopLogo' => _PS_BASE_URL_ . __PS_BASE_URI__ . 'img/' . Configuration::get('PS_LOGO'),
                'currency' => $this->context->currency->sign,
                'language' => Language::getIsoById($this->context->language->id),
                'storeId' => (string) $this->context->shop->id,
                'shopDomain' => Tools::getHttpHost(false),
                'trendingTitle' => $this->l('Trending Products')
            ]
        ]);

        // Add preconnect for performance
        $apiUrl = Configuration::get('CATASEEK_API_URL');
        if ($apiUrl) {
            $parsedUrl = parse_url($apiUrl);
            if (isset($parsedUrl['scheme']) && isset($parsedUrl['host'])) {
                $origin = $parsedUrl['scheme'] . '://' . $parsedUrl['host'];
                return '<link rel="preconnect" href="' . $origin . '" crossorigin>';
            }
        }

        return '';
    }

    /**
     * Hook: displayTop - Show search icon
     */
    public function hookDisplayTop()
    {
        // Fetch design settings (fallback to defaults if API call fails)
        $ds = $this->getCataseekSettings() ?: array(
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        );
        $customSelector = Configuration::get('CATASEEK_SELECTOR', '');

        $isHeader = strtolower(isset($ds['icon_position']) ? $ds['icon_position'] : 'Right') === 'header';
        $hasCustomSelector = !empty(trim($customSelector));

        // Display in Top hook only if position is Header or Custom Selector used
        if (!$isHeader && !$hasCustomSelector) {
            return '';
        }

        $this->context->smarty->assign([
            'icon_position' => $ds['icon_position'],
            'icon_color' => $ds['icon_color'],
            'icon_type' => $ds['icon_type'],
            'modal_size' => $ds['modal_size'],
            'shop_logo' => _PS_BASE_URL_ . __PS_BASE_URI__ . 'img/' . Configuration::get('PS_LOGO'),
            'custom_selector' => $hasCustomSelector,
        ]);

        return $this->display(__FILE__, 'views/templates/hook/cataseek-widget.tpl');
    }

    /**
     * Hook: displayFooter - Show floating search icon
     */
    public function hookDisplayFooter()
    {
        // Fetch design settings (fallback to defaults if API call fails)
        $ds = $this->getCataseekSettings() ?: array(
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        );
        $customSelector = Configuration::get('CATASEEK_SELECTOR', '');

        $isHeader = strtolower(isset($ds['icon_position']) ? $ds['icon_position'] : 'Right') === 'header';
        $hasCustomSelector = !empty(trim($customSelector));

        // If it's a Header icon or Custom Selector is used, it's already rendered in displayTop
        if ($isHeader || $hasCustomSelector) {
            return '';
        }

        $this->context->smarty->assign([
            'icon_position' => $ds['icon_position'],
            'icon_color' => $ds['icon_color'],
            'icon_type' => $ds['icon_type'],
            'modal_size' => $ds['modal_size'],
            'shop_logo' => _PS_BASE_URL_ . __PS_BASE_URI__ . 'img/' . Configuration::get('PS_LOGO'),
            'custom_selector' => false,
        ]);

        return $this->display(__FILE__, 'views/templates/hook/cataseek-widget.tpl');
    }

    /**
     * Sync single product to Cataseek API (across ALL active languages)
     * This prevents duplicate Meilisearch documents when the admin panel language changes.
     */
    public function syncProduct($productId)
    {
        if (!Configuration::get('CATASEEK_LIVE_MODE')) {
            return false;
        }

        $apiUrl = Configuration::get('CATASEEK_API_URL');
        $apiKey = Configuration::get('CATASEEK_API_KEY');
        $apiPassword = Configuration::get('CATASEEK_API_PASSWORD');

        if (!$apiUrl || !$apiKey || !$apiPassword) {
            return false;
        }

        $storeId = (string) $this->context->shop->id;
        $shopId = (int) $this->context->shop->id;
        $products = array();

        // Loop ALL active languages so the compound ID (external_id_lang_store) stays
        // stable regardless of which language the admin panel is using at save time.
        foreach (Language::getLanguages(true) as $lang) {
            $langId = (int) $lang['id_lang'];
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

            // Read stock directly from DB to bypass ORM cache.
            // The ORM may return 0 on actionObjectProductAddAfter because the
            // stock_available row may not have been committed yet within the same
            // request transaction when the hook fires.
            $quantity = (int) Db::getInstance()->getValue(
                'SELECT `quantity` FROM `' . _DB_PREFIX_ . 'stock_available`
                 WHERE `id_product` = ' . (int) $productId . '
                   AND `id_product_attribute` = 0
                   AND `id_shop` = ' . $shopId
            );

            $products[] = array(
                'external_id' => (string) $product->id,
                'name' => $product->name,
                'description' => strip_tags($product->description_short),
                'price' => (float) $product->getPrice(),
                'compare_price' => (float) $product->getPriceWithoutReduct(true),
                'quantity' => $quantity,
                'sku' => $product->reference,
                'categories' => $categories,
                'images' => $images,
                'status' => $product->active ? 'active' : 'inactive',
                'language' => $lang['iso_code'],
                'store_id' => $storeId,
                'url' => $this->context->link->getProductLink($product, null, null, null, $langId),
            );
        }

        if (empty($products)) {
            return false;
        }

        return $this->makeApiRequest('/products/sync', array('products' => $products));
    }


    /**
     * Sync all products in batches
     */
    public function syncAllProducts($offset = 0, $limit = 50)
    {
        $products = Product::getProducts(
            Context::getContext()->language->id,
            $offset,
            $limit,
            'id_product',
            'ASC',
            false,
            true
        );

        if (empty($products)) {
            return array('finished' => true, 'count' => 0);
        }

        $batch = array();
        $storeId = (string) $this->context->shop->id;
        $activeLanguages = Language::getLanguages(true);

        foreach ($products as $pData) {
            $productId = $pData['id_product'];

            // Loop all active languages for this product
            foreach ($activeLanguages as $lang) {
                $langId = (int) $lang['id_lang'];
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

                $batch[] = array(
                    'external_id' => (string) $product->id,
                    'name' => $product->name,
                    'description' => strip_tags($product->description_short),
                    'price' => (float) $product->getPrice(),
                    'compare_price' => (float) $product->getPriceWithoutReduct(true),
                    'quantity' => (int) StockAvailable::getQuantityAvailableByProduct($product->id),
                    'sku' => $product->reference,
                    'categories' => $categories,
                    'images' => $images,
                    'status' => $product->active ? 'active' : 'inactive',
                    'language' => $lang['iso_code'],
                    'store_id' => $storeId,
                    'url' => $this->context->link->getProductLink($product, null, null, null, $langId),
                );
            }
        }

        $data = array('products' => $batch);
        $response = $this->makeApiRequest('/products/sync', $data);

        return array(
            'finished' => count($products) < $limit,
            'count' => count($products),
            'response' => $response,
            'nextOffset' => $offset + $limit
        );
    }

    /**
     * Delete product from Cataseek
     */
    public function deleteProduct($productId)
    {
        if (!Configuration::get('CATASEEK_LIVE_MODE')) {
            return false;
        }

        $apiUrl = Configuration::get('CATASEEK_API_URL');
        $apiKey = Configuration::get('CATASEEK_API_KEY');
        $apiPassword = Configuration::get('CATASEEK_API_PASSWORD');

        if (!$apiUrl || !$apiKey || !$apiPassword) {
            return false;
        }

        // Use the actual shop ID — must match the store_id used at sync time
        // Sync uses: (string) $this->context->shop->id  →  e.g. "1"
        $storeId = (string) $this->context->shop->id;

        $idsToDelete = array();
        foreach (Language::getLanguages(true) as $lang) {
            // Format: {external_id}_{lang_iso}_{store_id}  — matches product.routes.ts line 121
            $idsToDelete[] = $productId . '_' . $lang['iso_code'] . '_' . $storeId;
        }

        $data = array(
            'product_ids' => $idsToDelete
        );

        $this->logToFile('Deleting product IDs: ' . implode(', ', $idsToDelete));

        return $this->makeApiRequest('/products/delete', $data);
    }

    /**
     * Make API request helper
     */
    private function makeApiRequest($endpoint, $data)
    {
        $apiUrl = Configuration::get('CATASEEK_API_URL');
        $apiKey = Configuration::get('CATASEEK_API_KEY');
        $apiPassword = Configuration::get('CATASEEK_API_PASSWORD');

        $fullUrl = $apiUrl . $endpoint . '?t=' . time();
        $this->logToFile("API Request to: $fullUrl");

        $ch = curl_init($fullUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        curl_setopt($ch, CURLOPT_HTTPHEADER, array(
            'Content-Type: application/json',
            'X-API-Key: ' . $apiKey,
            'X-API-Password: ' . $apiPassword,
            'X-Store-Domain: ' . Tools::getHttpHost(false)
        ));
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        $this->logToFile("API Response Code: $httpCode");
        if ($error) {
            $this->logToFile("cURL Error: $error");
        }

        return array(
            'success' => $httpCode >= 200 && $httpCode < 300,
            'code' => $httpCode,
            'response' => json_decode($response, true),
            'raw_response' => $response,
            'error' => $error
        );
    }

    /**
     * Log messages to a file
     */
    public function logToFile($message)
    {
        $logDir = $this->local_path . 'logs/';
        if (!is_dir($logDir)) {
            mkdir($logDir, 0755, true);
        }

        $logFile = $logDir . 'cataseek.log';
        $timestamp = date('Y-m-d H:i:s');
        $formattedMessage = "[$timestamp] $message" . PHP_EOL;

        file_put_contents($logFile, $formattedMessage, FILE_APPEND);
    }

    /**
     * Hook: Product update
     */
    public function hookActionObjectProductUpdateAfter($params)
    {
        if (isset($params['object']) && Validate::isLoadedObject($params['object'])) {
            $this->syncProduct($params['object']->id);
        }
    }

    /**
     * Hook: Product add
     */
    public function hookActionObjectProductAddAfter($params)
    {
        if (isset($params['object']) && Validate::isLoadedObject($params['object'])) {
            $this->syncProduct($params['object']->id);
        }
    }

    /**
     * Hook: Product delete
     */
    public function hookActionObjectProductDeleteAfter($params)
    {
        if (isset($params['object']) && isset($params['object']->id)) {
            $this->deleteProduct($params['object']->id);
        }
    }
}