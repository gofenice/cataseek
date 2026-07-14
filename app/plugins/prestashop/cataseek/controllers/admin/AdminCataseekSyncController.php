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

class AdminCataseekSyncController extends ModuleAdminController
{
    public function __construct()
    {
        parent::__construct();
        $this->bootstrap = true;
    }

    /**
     * Initialize content
     */
    public function initContent()
    {
        parent::initContent();
    }

    /**
     * AJAX endpoint for bulk sync
     */
    public function ajaxProcessBulkSync()
    {
        $offset = (int) Tools::getValue('offset', 0);
        $limit = 50;

        $module = Module::getInstanceByName('cataseek');

        if (!$module) {
            exit(json_encode([
                'success' => false,
                'message' => $this->module->l('Module not found'),
            ]));
        }

        try {
            /** @var Cataseek $module */
            $result = $module->syncAllProducts($offset, $limit);

            $apiSuccess = isset($result['response']['success']) ? (bool) $result['response']['success'] : true;
            $apiCode = isset($result['response']['code']) ? (int) $result['response']['code'] : 200;

            if (!$apiSuccess || ($apiCode >= 400)) {
                $apiError = '';
                if (isset($result['response']['response']['error'])) {
                    $apiError = $result['response']['response']['error'];
                } elseif (isset($result['response']['raw_response'])) {
                    $decoded = json_decode((string) $result['response']['raw_response'], true);
                    $apiError = isset($decoded['error']) ? $decoded['error'] : $result['response']['raw_response'];
                }
                if (empty($apiError)) {
                    $apiError = $this->module->l('API returned an error (HTTP ') . $apiCode . ')';
                }

                $module->logToFile('Batch Sync failed at API level (HTTP ' . $apiCode . '): ' . $apiError);

                exit(json_encode([
                    'success' => false,
                    'finished' => true,
                    'count' => 0,
                    'message' => $apiError,
                ]));
            }

            $accepted = isset($result['count']) ? (int) $result['count'] : 0;

            exit(json_encode([
                'success' => true,
                'finished' => $result['finished'],
                'count' => $accepted,
                'nextOffset' => isset($result['nextOffset']) ? $result['nextOffset'] : $offset + $limit,
                'message' => sprintf(
                    $this->module->l('Processed batch at offset %d (%d products accepted by Cataseek)'),
                    $offset,
                    $accepted
                ),
            ]));
        } catch (Exception $e) {
            $module->logToFile('Batch Sync Exception: ' . $e->getMessage());
            exit(json_encode([
                'success' => false,
                'message' => $e->getMessage(),
            ]));
        }
    }

    /**
     * AJAX endpoint to get total products count
     */
    public function ajaxProcessGetProductCount()
    {
        $sql = 'SELECT COUNT(*) FROM ' . _DB_PREFIX_ . 'product p ' . Shop::addSqlAssociation('product', 'p');
        $sql .= ' WHERE product_shop.active = 1';

        $count = Db::getInstance()->getValue($sql);

        exit(json_encode([
            'success' => true,
            'total' => (int) $count,
        ]));
    }

    /**
     * AJAX endpoint to test API connection
     */
    public function ajaxProcessTestConnection()
    {
        $apiUrl = Configuration::get('CATASEEK_API_URL');
        $apiKey = Configuration::get('CATASEEK_API_KEY');
        $apiPassword = Configuration::get('CATASEEK_API_PASSWORD');

        /** @var Cataseek $module */
        $module = $this->module;

        $keyPrefix = substr((string) $apiKey, 0, 8);
        $module->logToFile('Testing connection. URL: ' . $apiUrl . '/products/stats, Key begins with: ' . $keyPrefix);

        if (!$apiUrl || !$apiKey || !$apiPassword) {
            $module->logToFile('Connection test failed: Credentials not configured');
            exit(json_encode([
                'success' => false,
                'message' => $this->module->l('API credentials not configured'),
            ]));
        }

        $ch = curl_init($apiUrl . '/products/stats?t=' . time());

        $storeDomain = rtrim(
            str_replace(
                ['http://', 'https://'],
                '',
                $this->context->shop->getBaseURL()
            ),
            '/'
        );

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'X-API-Key: ' . $apiKey,
            'X-API-Password: ' . $apiPassword,
            'X-Store-Domain: ' . $storeDomain,
        ]);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        $module->logToFile('Connection test result - HTTP: ' . $httpCode . ', Error: ' . $error . ', Response: ' . $response);

        if ($httpCode >= 200 && $httpCode < 300) {
            exit(json_encode([
                'success' => true,
                'message' => $this->module->l('Connection successful!'),
            ]));
        }

        $msg = $this->module->l('Connection failed.');

        $jsonResponse = json_decode((string) $response, true);

        if (isset($jsonResponse['error'])) {
            $msg = $jsonResponse['error'];
        } elseif ($httpCode == 401) {
            $msg = $this->module->l('Connection failed: Invalid API Key or Password.');
        } elseif ($httpCode == 404) {
            $msg = $this->module->l('Connection failed: Endpoint not found. Please check your API URL.');
        }

        exit(json_encode([
            'success' => false,
            'message' => sprintf(
                '%s (HTTP %d). %s',
                $msg,
                $httpCode,
                $error
            ),
        ]));
    }
}
