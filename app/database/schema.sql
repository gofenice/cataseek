-- Tenants/Stores table
CREATE TABLE IF NOT EXISTS tenants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    store_name VARCHAR(255) NOT NULL,
    store_domain VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    -- Nullable: Google-only accounts (google_id set) have no password.
    password_hash VARCHAR(255) NULL,
    -- Google Sign-In identity (payload.sub) — NULL for password-only accounts.
    google_id VARCHAR(255) UNIQUE NULL,
    plan_id INT,
    api_key VARCHAR(64) UNIQUE,
    api_password_hash VARCHAR(255),
    meilisearch_index_name VARCHAR(100) UNIQUE,
    status ENUM('active', 'suspended', 'trial', 'cancelled') DEFAULT 'trial',
    trial_ends_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_api_key (api_key),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    billing_period ENUM('monthly', 'yearly') NOT NULL,
    max_products INT NOT NULL,
    max_requests_per_month INT NOT NULL,
    features JSON,
    is_active BOOLEAN DEFAULT TRUE,
    stripe_price_id VARCHAR(100),
    -- Yearly billing: a monthly row is the source of truth; its yearly
    -- sibling is auto-generated/kept in sync (see plan-sync.service.ts).
    yearly_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    parent_plan_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    plan_id INT NOT NULL,
    stripe_subscription_id VARCHAR(100) UNIQUE,
    status ENUM('active', 'past_due', 'cancelled', 'incomplete') DEFAULT 'active',
    current_period_start DATETIME,
    current_period_end DATETIME,
    cancelled_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    INDEX idx_tenant (tenant_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API Usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    request_count INT DEFAULT 1,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE KEY unique_tenant_endpoint_date (tenant_id, endpoint, date),
    INDEX idx_tenant_date (tenant_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default plans
INSERT INTO plans (name, description, price, billing_period, max_products, max_requests_per_month, features) VALUES
('Starter', 'Perfect for small stores', 29.99, 'monthly', 1000, 10000, '["Basic search", "1 store", "Email support"]'),
('Professional', 'For growing businesses', 79.99, 'monthly', 10000, 100000, '["Advanced search", "Multi-language", "5 stores", "Priority support"]'),
('Enterprise', 'For large enterprises', 199.99, 'monthly', 100000, 1000000, '["Custom search", "Unlimited stores", "Multi-language", "Multi-store", "24/7 support", "Dedicated account manager"]');

-- Note: Product tables are created dynamically per tenant with naming convention: products_{tenant_id}
-- Example structure for reference:
-- CREATE TABLE IF NOT EXISTS products_{tenant_id} (
--     id VARCHAR(50) PRIMARY KEY,
--     external_id VARCHAR(100) NOT NULL,
--     name VARCHAR(500) NOT NULL,
--     description TEXT,
--     price DECIMAL(10, 2),
--     compare_price DECIMAL(10, 2),
--     quantity INT DEFAULT 0,
--     sku VARCHAR(100),
--     categories JSON,
--     attributes JSON,
--     images JSON,
--     language VARCHAR(10) DEFAULT 'en',
--     store_id VARCHAR(50),
--     status ENUM('active', 'inactive', 'draft') DEFAULT 'active',
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--     INDEX idx_external_id (external_id),
--     INDEX idx_status (status),
--     INDEX idx_language (language),
--     INDEX idx_store_id (store_id)
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invoices table (billing history)
CREATE TABLE IF NOT EXISTS invoices (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id        INT NOT NULL,
    invoice_number   VARCHAR(30) NOT NULL,
    plan_name        VARCHAR(100) NOT NULL,
    billing_reason   VARCHAR(100) NOT NULL DEFAULT 'subscription_cycle',
    amount           DECIMAL(10,2) NOT NULL,
    currency         VARCHAR(10) NOT NULL DEFAULT 'USD',
    status           ENUM('paid','pending','failed') NOT NULL DEFAULT 'pending',
    period_start     DATETIME,
    period_end       DATETIME,
    paid_at          DATETIME,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_tenant (tenant_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tenant domains table
CREATE TABLE IF NOT EXISTS tenant_domains (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id  INT NOT NULL,
  domain     VARCHAR(253) NOT NULL,
  label      VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_domain (domain),
  INDEX idx_tenant (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
