<?php
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['SERVER_NAME'] = 'localhost';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';

require_once('../../config/config.inc.php');
require_once('../../init.php');

$apiUrl = Configuration::get('CATASEEK_API_URL');
$apiKey = Configuration::get('CATASEEK_API_KEY');
$currentHost = Configuration::get('PS_SHOP_DOMAIN'); // Better than Tools::getHttpHost() for CLI

echo "--- Cataseek API Config ---\n";
echo "API URL: $apiUrl\n";
echo "API Key: " . substr($apiKey, 0, 8) . "...\n";
echo "Shop Domain: $currentHost\n\n";

$publicSearchUrl = $apiUrl . '/products/public/search';

function testSearch($scenarioName, $payload, $domain = null)
{
    global $publicSearchUrl, $apiKey, $currentHost;

    $domainToUse = $domain ? $domain : $currentHost;
    $headers = [
        'Content-Type: application/json',
        'X-API-Key: ' . $apiKey,
        'X-Store-Domain: ' . $domainToUse
    ];

    echo "=== Scenario: $scenarioName ===\n";
    echo "Domain Header: $domainToUse\n";
    echo "Payload: " . json_encode($payload) . "\n";

    $ch = curl_init($publicSearchUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    echo "HTTP Status: $httpCode\n";

    $data = json_decode($response, true);
    if ($data && isset($data['results'])) {
        echo "Found " . count($data['results']) . " results. Total: " . (isset($data['total']) ? $data['total'] : 'Unknown') . "\n";
    } else {
        echo "Response: " . substr($response, 0, 300) . "\n";
    }
    echo "\n";
}

// 1. Minimum payload (like test_search.php works)
testSearch("Minimum Payload", [
    'query' => 'shirt',
    'limit' => 5
]);

// 2. Front-end Payload exactly as cataseek-front.js would send it if language/storeId weren't commented out
testSearch("Frontend Payload with Context", [
    'query' => 'shirt',
    'limit' => 12,
    'offset' => 0,
    'language' => Language::getIsoById(Context::getContext()->language->id),
    'store_id' => (string) Context::getContext()->shop->id
]);

// 3. Frontend Payload without language/storeId but WITH weird filtering (e.g. price)
testSearch("Frontend Payload with empty arrays/nulls", [
    'query' => 'shirt',
    'limit' => 12,
    'offset' => 0,
    'categories' => []
]);

?>