<?php
/**
 * Test script for Cataseek Search API
 * Access this file directly in browser: your-shop-url/modules/cataseek/test_search.php
 */

require_once('../../config/config.inc.php');
require_once('../../init.php');

$apiUrl = Configuration::get('CATASEEK_API_URL');
$apiKey = Configuration::get('CATASEEK_API_KEY');
$publicSearchUrl = $apiUrl . '/products/public/search';

// Get current host for domain verification check
$currentHost = Tools::getHttpHost(false);

?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cataseek API Test</title>
    <style>
        body {
            font-family: sans-serif;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }

        .config-box {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }

        input {
            padding: 10px;
            width: 100%;
            box-sizing: border-box;
            font-size: 16px;
            margin-bottom: 10px;
        }

        button {
            padding: 10px 20px;
            background: #4F46E5;
            color: white;
            border: none;
            cursor: pointer;
            font-size: 16px;
            border-radius: 5px;
        }

        button:hover {
            background: #4338ca;
        }

        #results {
            margin-top: 20px;
            border-top: 1px solid #eee;
            padding-top: 20px;
        }

        .result-item {
            padding: 10px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
        }

        .result-item img {
            width: 50px;
            height: 50px;
            object-fit: cover;
            margin-right: 15px;
        }

        .result-title {
            font-weight: bold;
        }

        .result-price {
            color: #2ecc71;
            font-weight: bold;
            margin-left: auto;
        }

        pre {
            background: #333;
            color: #fff;
            padding: 10px;
            overflow: auto;
            border-radius: 5px;
        }

        .status {
            padding: 10px;
            margin-bottom: 10px;
            display: none;
            border-left: 4px solid;
        }

        .success {
            background: #d4edda;
            border-color: #28a745;
            color: #155724;
        }

        .error {
            background: #f8d7da;
            border-color: #dc3545;
            color: #721c24;
        }
    </style>
</head>

<body>
    <h1>Cataseek Public Search Test</h1>

    <div class="config-box">
        <h3>Configuration</h3>
        <p><strong>API URL:</strong> <?php echo $apiUrl; ?></p>
        <p><strong>Public Search Endpoint:</strong> <?php echo $publicSearchUrl; ?></p>
        <p><strong>API Key:</strong> <?php echo substr($apiKey, 0, 8) . '...'; ?></p>
        <p><strong>Current Domain:</strong> <?php echo $currentHost; ?></p>
    </div>

    <div>
        <input type="text" id="query" placeholder="Enter search term (e.g., 'shirt')" value="shirt">
        <button onclick="runSearch()">Test Search</button>
    </div>

    <div id="status" class="status"></div>
    <h3>Visual Results</h3>
    <div id="results"></div>

    <h3>Raw Response</h3>
    <pre id="raw-output">Click 'Test Search' to see results...</pre>

    <script>
        const API_URL = "<?php echo $publicSearchUrl; ?>";
        const API_KEY = "<?php echo $apiKey; ?>";
        const DOMAIN = "<?php echo $currentHost; ?>";

        async function runSearch() {
            const query = document.getElementById('query').value;
            const output = document.getElementById('raw-output');
            const resultsDiv = document.getElementById('results');
            const statusDiv = document.getElementById('status');

            output.innerText = 'Searching...';
            resultsDiv.innerHTML = '';
            statusDiv.style.display = 'none';

            try {
                console.log('Sending request to:', API_URL);

                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': API_KEY,
                        'X-Store-Domain': DOMAIN
                    },
                    body: JSON.stringify({
                        query: query,
                        limit: 5
                    })
                });

                const data = await response.json();
                output.innerText = JSON.stringify(data, null, 2);

                if (response.ok) {
                    statusDiv.innerText = `Success! Status: ${response.status}`;
                    statusDiv.className = 'status success';

                    if (data.results && data.results.length > 0) {
                        data.results.forEach(item => {
                            const resultEl = document.createElement('div');
                            resultEl.className = 'result-item';
                            const img = item.images && item.images[0] ? item.images[0] : 'https://via.placeholder.com/50';
                            resultEl.innerHTML = `
                                <img src="${img}" alt="img">
                                <div>
                                    <div class="result-title">${item.name}</div>
                                    <small>${item.description ? item.description.substring(0, 50) + '...' : ''}</small>
                                </div>
                                <div class="result-price">$${item.price}</div>
                            `;
                            resultsDiv.appendChild(resultEl);
                        });
                    } else {
                        resultsDiv.innerHTML = '<p>No results found for this query.</p>';
                    }
                } else {
                    statusDiv.innerText = `Error! Status: ${response.status} - ${data.error || 'Unknown error'}`;
                    statusDiv.className = 'status error';
                }
                statusDiv.style.display = 'block';

            } catch (error) {
                console.error('Error:', error);
                output.innerText = 'Network/JS Error: ' + error.message;
                statusDiv.innerText = 'Network Error: See console for details.';
                statusDiv.className = 'status error';
                statusDiv.style.display = 'block';
            }
        }
    </script>
</body>

</html>