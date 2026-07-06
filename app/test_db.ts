import { query } from './src/config/database';

async function check() {
  const tenants = await query('SELECT id, email, api_key FROM tenants;');
  console.log("TENANTS:", tenants);
  const settings = await query('SELECT * FROM tenant_settings;');
  console.log("SETTINGS:", settings);
  process.exit(0);
}
check();
