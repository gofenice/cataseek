const mysql = require("mysql2/promise");

const ROOT_DB_CONFIG = {
  host: "127.0.0.1",
  user: "kxyvtcbhgw",
  password: "mg9tNfBquP",
};

const TEST_DB_NAME = "cataseek_test_store_001";

async function run() {
  let connection;

  try {
    console.log("🔌 Connecting to MySQL...");
    connection = await mysql.createConnection(ROOT_DB_CONFIG);

    // 1. Create database
    console.log("📦 Creating database...");
    await connection.query(`
      CREATE DATABASE IF NOT EXISTS \`${TEST_DB_NAME}\`
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_unicode_ci
    `);

    // 2. Switch to new DB
    await connection.changeUser({ database: TEST_DB_NAME });

    // 3. Create products table
    console.log("📄 Creating products table...");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        external_id VARCHAR(255) NOT NULL,
        name TEXT NOT NULL,
        price DECIMAL(10,2) NULL,
        quantity INT NULL,
        active BOOLEAN DEFAULT 1,
        raw_data JSON NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 4. Insert test product
    console.log("➕ Inserting test product...");
    await connection.query(
      `
      INSERT INTO products (external_id, name, price, quantity, raw_data)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        "TEST-123",
        "Test Product",
        99.99,
        10,
        JSON.stringify({ note: "corrupt or optional data goes here" }),
      ]
    );

    // 5. Read back
    const [rows] = await connection.query("SELECT * FROM products");
    console.log("✅ Products read from DB:", rows);

    console.log("🎉 DB provisioning test SUCCESSFUL");
  } catch (err) {
    console.error("❌ DB provisioning test FAILED");
    console.error(err.message);
  } finally {
    if (connection) await connection.end();
  }
}

run();
