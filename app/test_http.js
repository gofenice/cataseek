const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/tenants/settings/public',
  method: 'GET',
  headers: {
    'x-api-key': '1979e0bf94dae47c1cc0dc2aa8b5ca488a4b017003ac99b043c271db1c02db57',
    'x-api-password': 'cataseek@123'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`BODY: ${data}`);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
