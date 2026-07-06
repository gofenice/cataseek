<?php
require_once('../../config/config.inc.php');
require_once('../../init.php');

header('Content-Type: application/json');

$results = [
    'Tools::getHttpHost(false)' => Tools::getHttpHost(false),
    'Tools::getHttpHost(true)' => Tools::getHttpHost(true),
    '$_SERVER["HTTP_HOST"]' => isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'N/A',
    '$_SERVER["SERVER_NAME"]' => isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'N/A',
    'Language ISO' => Language::getIsoById(Context::getContext()->language->id),
    'Shop ID' => (string)Context::getContext()->shop->id,
];

echo json_encode($results, JSON_PRETTY_PRINT);
