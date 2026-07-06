<?php
/**
 * Admin Controller for Cataseek Sync Operations
 *
 * @author    gofenice
 * @copyright 2026 gofenice
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
        $offset = (int)Tools::getValue('offset', 0);
        $limit = 50; // Process 50 products at a time

        $module = Module::getInstanceByName('cataseek');
        
        if (!$module) {
            die(json_encode([
                'success' => false,
                'message' => $this->module->l('Module not found')
            ]));
        }

        try {
            /** @var Cataseek $module */
            $result = $module->syncAllProducts($offset, $limit);

            // ── Detect API-level failures (e.g. 403 plan limit, 401 auth error) ──
            // $result['response'] is the decoded JSON from makeApiRequest():
            //   ['success' => bool, 'code' => int, 'response' => array, 'error' => string]
            $apiSuccess = isset($result['response']['success']) ? (bool)$result['response']['success'] : true;
            $apiCode    = isset($result['response']['code'])    ? (int)$result['response']['code']    : 200;

            if (!$apiSuccess || ($apiCode >= 400)) {
                // Extract the human-readable error from the API JSON body
                $apiError = '';
                if (isset($result['response']['response']['error'])) {
                    $apiError = $result['response']['response']['error'];
                } elseif (isset($result['response']['raw_response'])) {
                    $decoded = json_decode($result['response']['raw_response'], true);
                    $apiError = isset($decoded['error']) ? $decoded['error'] : $result['response']['raw_response'];
                }
                if (empty($apiError)) {
                    $apiError = $this->module->l('API returned an error (HTTP ') . $apiCode . ')';
                }

                $module->logToFile("Batch Sync failed at API level (HTTP $apiCode): $apiError");

                die(json_encode([
                    'success' => false,
                    'finished' => true, // stop the JS loop immediately
                    'count'   => 0,
                    'message' => $apiError,
                ]));
            }

            // The API response stats tracks database rows (including all translations).
            // To ensure the progress bar aligns with PrestaShop's "Total Products" metric,
            // we use the number of base products fetched and processed in this batch.
            $accepted = isset($result['count']) ? (int)$result['count'] : 0;

            die(json_encode([
                'success'    => true,
                'finished'   => $result['finished'],
                'count'      => $accepted,
                'nextOffset' => isset($result['nextOffset']) ? $result['nextOffset'] : $offset + $limit,
                'message'    => sprintf(
                    $this->module->l('Processed batch at offset %d (%d products accepted by Cataseek)'),
                    $offset,
                    $accepted
                )
            ]));
        } catch (Exception $e) {
            $module->logToFile("Batch Sync Exception: " . $e->getMessage());
            die(json_encode([
                'success' => false,
                'message' => $e->getMessage()
            ]));
        }
    }

    /**
     * AJAX endpoint to get total products count
     */
    public function ajaxProcessGetProductCount()
    {
        $sql = 'SELECT COUNT(*) FROM ' . _DB_PREFIX_ . 'product p ' . Shop::addSqlAssociation('product', 'p');
        
        // Optionally filter by active state only, if that's what we want
        $sql .= ' WHERE product_shop.active = 1';

        $count = Db::getInstance()->getValue($sql);

        die(json_encode([
            'success' => true,
            'total' => (int)$count
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
        
        $keyPrefix = substr($apiKey, 0, 8);
        $module->logToFile("Testing connection. URL: " . $apiUrl . "/products/stats, Key begins with: " . $keyPrefix);

        if (!$apiUrl || !$apiKey || !$apiPassword) {
            $module->logToFile("Connection test failed: Credentials not configured");
            die(json_encode([
                'success' => false,
                'message' => $this->module->l('API credentials not configured')
            ]));
        }

        // Test connection with a REAL authenticated endpoint
        // Added timestamp to bypass Varnish cache
        $ch = curl_init($apiUrl . '/products/stats?t=' . time());
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array(
            'Content-Type: application/json',
            'X-API-Key: ' . $apiKey,
            'X-API-Password: ' . $apiPassword,
            'X-Store-Domain: ' . Tools::getHttpHost(false)
        ));
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        $module->logToFile("Connection test result - HTTP: $httpCode, Error: $error, Response: " . $response);

        if ($httpCode >= 200 && $httpCode < 300) {
            die(json_encode([
                'success' => true,
                'message' => $this->module->l('Connection successful!')
            ]));
        } else {
            $msg = $this->module->l('Connection failed.');
            
            // Try to parse the real error from the API response
            $jsonResponse = json_decode($response, true);
            if (isset($jsonResponse['error'])) {
                 $msg = $jsonResponse['error'];
            } else {
                if ($httpCode == 401) {
                    $msg = $this->module->l('Connection failed: Invalid API Key or Password.');
                } elseif ($httpCode == 404) {
                    $msg = $this->module->l('Connection failed: Endpoint not found. Please check your API URL.');
                }
            }

            die(json_encode([
                'success' => false,
                'message' => sprintf(
                    '%s (HTTP %d). %s',
                    $msg,
                    $httpCode,
                    $error
                )
            ]));
        }
    }
}