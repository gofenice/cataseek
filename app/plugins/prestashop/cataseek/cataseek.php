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
        $this->ps_versions_compliancy = ['min' => '1.7.0.0', 'max' => '9.99.99'];
    }

    /**
     * Module installation
     */
    public function install()
    {
        Configuration::updateValue('CATASEEK_LIVE_MODE', false);
        Configuration::updateValue('CATASEEK_API_URL', 'https://admin.cataseek.com/api');

        return parent::install()
            && $this->installTab()
            && $this->registerHook('displayHeader')
            && $this->registerHook('displayTop')
            && $this->registerHook('displayFooter')
            && $this->registerHook('actionObjectProductUpdateAfter')
            && $this->registerHook('actionObjectProductAddAfter')
            && $this->registerHook('actionObjectProductDeleteAfter');
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
        $tab->active = true;
        $tab->class_name = 'AdminCataseekSync';
        $tab->name = [];
        foreach (Language::getLanguages(true) as $lang) {
            $tab->name[$lang['id_lang']] = 'Cataseek Sync';
        }
        $tab->id_parent = -1;
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

        $isHttps = (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')
            || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');

        $ajaxUrl = $this->context->link->getAdminLink('AdminCataseekSync');
        if ($isHttps) {
            $ajaxUrl = str_replace('http://', 'https://', $ajaxUrl);
        }

        $formHtml = $this->renderForm($isHttps);

        $this->context->smarty->assign([
            'module_dir' => $this->_path,
            'ajax_url' => $ajaxUrl,
        ]);

        $tplContent = $this->context->smarty->fetch($this->local_path . 'views/templates/admin/configure.tpl');

        $output .= str_replace('<!-- CATASEEK_FORM_HTML_PLACEHOLDER -->', $formHtml, $tplContent);

        return $output;
    }

    /**
     * Create the configuration form
     */
    protected function renderForm($isHttps = false)
    {
        $helper = new HelperForm();

        $helper->show_toolbar = false;
        $helper->table = $this->table;
        $helper->module = $this;
        $helper->default_form_language = $this->context->language->id;
        $helper->allow_employee_form_lang = (int) Configuration::get('PS_BO_ALLOW_EMPLOYEE_FORM_LANG');

        $helper->identifier = $this->identifier;
        $helper->submit_action = 'submitCataseekModule';
        $currentIndex = $this->context->link->getAdminLink('AdminModules', false)
            . '&configure=' . $this->name . '&tab_module=' . $this->tab . '&module_name=' . $this->name;

        if ($isHttps) {
            $currentIndex = str_replace('http://', 'https://', $currentIndex);
        }
        $helper->currentIndex = $currentIndex;
        $helper->token = Tools::getAdminTokenLite('AdminModules');

        $helper->tpl_vars = [
            'fields_value' => $this->getConfigFormValues(),
            'languages' => $this->context->controller->getLanguages(),
            'id_language' => $this->context->language->id,
        ];

        return $helper->generateForm([$this->getConfigForm()]);
    }

    /**
     * Create the form structure
     */
    protected function getConfigForm()
    {
        return [
            'form' => [
                'legend' => [
                    'title' => $this->l('Cataseek AI Search Configuration'),
                    'icon' => 'icon-cogs',
                ],
                'input' => [
                    [
                        'type' => 'html',
                        'name' => '',
                        'html_content' => $this->context->smarty->fetch($this->local_path . 'views/templates/admin/api_settings_heading.tpl'),
                    ],
                    [
                        'type' => 'switch',
                        'label' => $this->l('Live mode'),
                        'name' => 'CATASEEK_LIVE_MODE',
                        'is_bool' => true,
                        'desc' => $this->l('Enable this to start syncing products to Cataseek'),
                        'values' => [
                            [
                                'id' => 'active_on',
                                'value' => true,
                                'label' => $this->l('Enabled'),
                            ],
                            [
                                'id' => 'active_off',
                                'value' => false,
                                'label' => $this->l('Disabled'),
                            ],
                        ],
                    ],
                    [
                        'col' => 6,
                        'type' => 'hidden',
                        'desc' => $this->l('The URL of your Cataseek API instance'),
                        'name' => 'CATASEEK_API_URL',
                        'label' => $this->l('API URL'),
                        'required' => true,
                    ],
                    [
                        'col' => 6,
                        'type' => 'text',
                        'name' => 'CATASEEK_API_KEY',
                        'label' => $this->l('API Key'),
                        'required' => true,
                    ],
                    [
                        'col' => 4,
                        'type' => 'password',
                        'name' => 'CATASEEK_API_PASSWORD',
                        'label' => $this->l('API Password'),
                        'required' => true,
                    ],
                    [
                        'col' => 6,
                        'type' => 'text',
                        'label' => $this->l('Search Input Selector'),
                        'name' => 'CATASEEK_SELECTOR',
                        'desc' => $this->l('CSS selector for the search input to override. Leave empty for defaults.'),
                    ],
                    [
                        'type' => 'free',
                        'label' => $this->l('Design Settings'),
                        'name' => 'CATASEEK_DESIGN_SETTINGS_HTML',
                    ],
                ],
                'submit' => [
                    'title' => $this->l('Save Settings'),
                ],
            ],
        ];
    }

    /**
     * Get configuration values
     */
    protected function getConfigFormValues()
    {
        $refreshUrl = $this->context->link->getAdminLink('AdminModules', true)
            . '&configure=' . $this->name . '&tab_module=' . $this->tab
            . '&module_name=' . $this->name . '&submitCataseekRefreshSettings=1';

        $this->context->smarty->assign([
            'cataseek_dashboard_url' => 'https://admin.cataseek.com/settings',
            'cataseek_refresh_url' => $refreshUrl,
        ]);

        return [
            'CATASEEK_LIVE_MODE' => (bool) Configuration::get('CATASEEK_LIVE_MODE'),
            'CATASEEK_API_URL' => Configuration::get('CATASEEK_API_URL') ?: 'https://admin.cataseek.com/api',
            'CATASEEK_API_KEY' => Configuration::get('CATASEEK_API_KEY'),
            'CATASEEK_API_PASSWORD' => '',
            'CATASEEK_SELECTOR' => Configuration::get('CATASEEK_SELECTOR'),
            'CATASEEK_DESIGN_SETTINGS_HTML' => $this->context->smarty->fetch($this->local_path . 'views/templates/admin/design_settings.tpl'),
        ];
    }

    /**
     * Fetch design settings from the Cataseek SaaS API.
     * Results are cached in PS Configuration for 1 hour to avoid an API call on every page load.
     */
    private function getCataseekSettings($forceRefresh = false)
    {
        $defaults = [
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        ];

        $cachedAt = (int) Configuration::get('CATASEEK_SETTINGS_CACHED_AT');
        $cacheAge = time() - $cachedAt;

        if (!$forceRefresh && $cacheAge < 3600) {
            $cached = Configuration::get('CATASEEK_CACHED_SETTINGS');
            if ($cached) {
                $decoded = json_decode((string) $cached, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }

        $apiUrl = rtrim((string) (Configuration::get('CATASEEK_API_URL') ?: 'https://admin.cataseek.com/api'), '/');
        $apiKey = (string) Configuration::get('CATASEEK_API_KEY');
        $apiPass = (string) Configuration::get('CATASEEK_API_PASSWORD');

        if (empty($apiKey) || empty($apiPass)) {
            return $defaults;
        }

        $cacheBuster = '?t=' . time();
        $ch = curl_init($apiUrl . '/tenants/settings/public' . $cacheBuster);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER => [
                'X-Api-Key: ' . $apiKey,
                'X-Api-Password: ' . $apiPass,
                'X-Store-Domain: ' . $this->getStoreDomain(),
                'Content-Type: application/json',
            ],
        ]);
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($httpCode === 200 && $response) {
            $data = json_decode((string) $response, true);
            if (isset($data['settings']) && is_array($data['settings'])) {
                $settings = array_merge($defaults, $data['settings']);
                Configuration::updateValue('CATASEEK_CACHED_SETTINGS', json_encode($settings));
                Configuration::updateValue('CATASEEK_SETTINGS_CACHED_AT', time());

                return $settings;
            }
        }

        $lastLog = (int) Configuration::get('CATASEEK_LAST_LOG_AT');
        if ((time() - $lastLog) > 3600) {
            Configuration::updateValue('CATASEEK_LAST_LOG_AT', time());
            $logMsg = '[Cataseek] Settings fetch FAILED.';
            $logMsg .= ' HTTP code: ' . $httpCode;
            $logMsg .= ' | cURL error: ' . ($curlErr ?: 'none');
            $logMsg .= ' | API URL: ' . $apiUrl . '/tenants/settings/public';
            $logMsg .= ' | Response: ' . substr((string) $response, 0, 300);
            PrestaShopLogger::addLog($logMsg, 2, null);
        }

        return false;
    }

    /**
     * Save form data
     */
    protected function postProcess()
    {
        $form_values = $this->getConfigFormValues();

        foreach (array_keys($form_values) as $key) {
            $value = Tools::getValue($key);

            if ($key === 'CATASEEK_API_PASSWORD' && empty($value)) {
                continue;
            }

            Configuration::updateValue($key, $value);
        }
    }

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

        $designSettings = $this->getCataseekSettings() ?: [
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        ];

        $selector = Configuration::get('CATASEEK_SELECTOR');
        $hasCachedSettings = !empty(Configuration::get('CATASEEK_CACHED_SETTINGS'));
        if (empty($selector) && !$hasCachedSettings) {
            $selector = '#search_widget input, input[name="s"], input[name="search_query"]';
        }

        Media::addJsDef([
            'cataseekConfig' => [
                'apiUrl' => Configuration::get('CATASEEK_API_URL'),
                'apiKey' => Configuration::get('CATASEEK_API_KEY'),
                'selector' => $selector,
                'color' => $designSettings['theme_color'],
                'iconColor' => $designSettings['icon_color'],
                'modalSize' => $designSettings['modal_size'],
                'minChars' => 2,
                'shopLogo' => _PS_BASE_URL_ . __PS_BASE_URI__ . 'img/' . Configuration::get('PS_LOGO'),
                'currency' => $this->context->currency->sign,
                'language' => Language::getIsoById($this->context->language->id),
                'storeId' => (string) $this->context->shop->id,
                'shopDomain' => $this->getStoreDomain(),
                'trendingTitle' => $this->l('Trending Products'),
                'labelPrice' => $this->l('Price'),
                'labelCategories' => $this->l('Categories'),
                'labelClearAll' => $this->l('Clear all filters'),
            ],
        ]);

        $apiUrl = Configuration::get('CATASEEK_API_URL');
        if ($apiUrl) {
            $parsedUrl = parse_url((string) $apiUrl);
            if (isset($parsedUrl['scheme']) && isset($parsedUrl['host'])) {
                $origin = $parsedUrl['scheme'] . '://' . $parsedUrl['host'];
                $this->context->smarty->assign(['cataseek_api_origin' => $origin]);

                return $this->display(__FILE__, 'views/templates/hook/header.tpl');
            }
        }

        return '';
    }

    /**
     * Hook: displayTop - Show search icon
     */
    public function hookDisplayTop()
    {
        $ds = $this->getCataseekSettings() ?: [
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        ];

        $customSelector = Configuration::get('CATASEEK_SELECTOR');

        $isHeader = strtolower(isset($ds['icon_position']) ? $ds['icon_position'] : 'Right') === 'header';
        $hasCustomSelector = !empty(trim((string) $customSelector));

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
        $ds = $this->getCataseekSettings() ?: [
            'theme_color' => '#4F46E5',
            'icon_color' => '#4F46E5',
            'icon_type' => 'Icon',
            'modal_size' => 'Large',
            'icon_position' => 'Right',
        ];

        $customSelector = Configuration::get('CATASEEK_SELECTOR');

        $isHeader = strtolower(isset($ds['icon_position']) ? $ds['icon_position'] : 'Right') === 'header';
        $hasCustomSelector = !empty(trim((string) $customSelector));

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
        $products = [];

        foreach (Language::getLanguages(true) as $lang) {
            $langId = (int) $lang['id_lang'];
            $product = new Product($productId, true, $langId);

            if (!Validate::isLoadedObject($product)) {
                continue;
            }

            $categories = [];
            foreach ($product->getCategories() as $catId) {
                $category = new Category($catId, $langId);
                if (Validate::isLoadedObject($category)) {
                    $categories[] = $category->name;
                }
            }

            $images = [];
            foreach ($product->getImages($langId) as $image) {
                $images[] = $this->context->link->getImageLink(
                    $product->link_rewrite,
                    $image['id_image'],
                    'large_default'
                );
            }

            $quantity = (int) Db::getInstance()->getValue(
                'SELECT `quantity` FROM `' . _DB_PREFIX_ . 'stock_available`
                 WHERE `id_product` = ' . (int) $productId . '
                   AND `id_product_attribute` = 0
                   AND `id_shop` = ' . $shopId
            );

            $products[] = [
                'external_id' => (string) $product->id,
                'name' => $product->name,
                'description' => strip_tags((string) $product->description_short),
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
            ];
        }

        if (empty($products)) {
            return false;
        }

        return $this->makeApiRequest('/products/sync', ['products' => $products]);
    }

    /**
     * Sync all products in batches
     */
    public function syncAllProducts($offset = 0, $limit = 50)
    {
        $products = Product::getProducts(
            (int) $this->context->language->id,
            $offset,
            $limit,
            'id_product',
            'ASC',
            false,
            true
        );

        if (empty($products)) {
            return ['finished' => true, 'count' => 0];
        }

        $batch = [];
        $storeId = (string) $this->context->shop->id;
        $activeLanguages = Language::getLanguages(true);

        foreach ($products as $pData) {
            $productId = $pData['id_product'];

            foreach ($activeLanguages as $lang) {
                $langId = (int) $lang['id_lang'];
                $product = new Product($productId, true, $langId);

                if (!Validate::isLoadedObject($product)) {
                    continue;
                }

                $categories = [];
                foreach ($product->getCategories() as $catId) {
                    $category = new Category($catId, $langId);
                    if (Validate::isLoadedObject($category)) {
                        $categories[] = $category->name;
                    }
                }

                $images = [];
                foreach ($product->getImages($langId) as $image) {
                    $images[] = $this->context->link->getImageLink(
                        $product->link_rewrite,
                        $image['id_image'],
                        'large_default'
                    );
                }

                $batch[] = [
                    'external_id' => (string) $product->id,
                    'name' => $product->name,
                    'description' => strip_tags((string) $product->description_short),
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
                ];
            }
        }

        $data = ['products' => $batch];
        $response = $this->makeApiRequest('/products/sync', $data);

        return [
            'finished' => count($products) < $limit,
            'count' => count($products),
            'response' => $response,
            'nextOffset' => $offset + $limit,
        ];
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

        $storeId = (string) $this->context->shop->id;

        $idsToDelete = [];
        foreach (Language::getLanguages(true) as $lang) {
            $idsToDelete[] = $productId . '_' . $lang['iso_code'] . '_' . $storeId;
        }

        $data = [
            'product_ids' => $idsToDelete,
        ];

        $this->logToFile('Deleting product IDs: ' . implode(', ', $idsToDelete));

        return $this->makeApiRequest('/products/delete', $data);
    }

    /**
     * Returns the current shop's domain, normalized (no scheme, no trailing slash).
     * Uses PrestaShop's getBaseURL() which respects the active shop context in
     * multi-store setups — unlike Tools::getHttpHost() which returns the server host
     * and can differ from the shop's configured domain.
     */
    private function getStoreDomain(): string
    {
        return rtrim(
            str_replace(
                ['http://', 'https://', 'www.'],
                '',
                $this->context->shop->getBaseURL()
            ),
            '/'
        );
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
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'X-API-Key: ' . $apiKey,
            'X-API-Password: ' . $apiPassword,
            'X-Store-Domain: ' . $this->getStoreDomain(),
        ]);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        $this->logToFile("API Response Code: $httpCode");
        if ($error) {
            $this->logToFile("cURL Error: $error");
        }

        return [
            'success' => $httpCode >= 200 && $httpCode < 300,
            'code' => $httpCode,
            'response' => json_decode((string) $response, true),
            'raw_response' => $response,
            'error' => $error,
        ];
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
