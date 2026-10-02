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
    -- Billing currency picked with the currency switcher (NULL = follow country_code)
    billing_currency VARCHAR(3) NULL,
    country_code VARCHAR(2) NULL,
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
    razorpay_subscription_id VARCHAR(64) NULL,
    -- Access state (see subscription-lifecycle.service.ts); gateway_status mirrors Razorpay
    status ENUM('active', 'trialing', 'past_due', 'cancelled', 'incomplete') DEFAULT 'active',
    gateway_status VARCHAR(20) NULL,
    gateway_event_at BIGINT NULL,
    checkout_type VARCHAR(20) NULL,
    starts_at DATETIME NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    -- Currency this subscription is billed in (NULL = base currency)
    currency VARCHAR(3) NULL,
    pending_plan_id INT NULL,
    pending_plan_change_at DATETIME NULL,
    current_period_start DATETIME,
    current_period_end DATETIME,
    cancelled_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id),
    INDEX idx_tenant (tenant_id),
    INDEX idx_status (status),
    INDEX idx_rzp_sub (razorpay_subscription_id),
    -- one local row per Razorpay subscription (NULL for demo-mode rows)
    UNIQUE KEY uq_rzp_subscription (razorpay_subscription_id)
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

-- Insert default plans (monthly roots; yearly siblings are generated from
-- yearly_discount_percent at startup — see plan-sync.service.ts)
INSERT INTO plans (name, description, price, billing_period, max_products, max_requests_per_month, features, yearly_discount_percent) VALUES
('Starter', 'Perfect for small stores', 19.99, 'monthly', 1000, 10000, '["Basic search", "1 store", "Email support"]', 16.63),
('Professional', 'For growing businesses', 49.99, 'monthly', 10000, 100000, '["Advanced search", "Multi-language", "5 stores", "Priority support"]', 16.65),
('Enterprise', 'For large enterprises', 199.99, 'monthly', 100000, 1000000, '["Custom search", "Unlimited stores", "Multi-language", "Multi-store", "24/7 support", "Dedicated account manager"]', 16.66);

-- Price of a plan in currencies other than the base currency (plans.price /
-- hosting_plans.price hold the base currency price) — see currency.service.ts
CREATE TABLE IF NOT EXISTS plan_prices (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    plan_table    ENUM('plans','hosting_plans') NOT NULL,
    local_plan_id INT NOT NULL,
    currency      VARCHAR(3) NOT NULL,
    price         DECIMAL(10,2) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_plan_currency (plan_table, local_plan_id, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Razorpay plan mapping per gateway mode (test/live) and currency — see razorpay.service.ts
CREATE TABLE IF NOT EXISTS razorpay_plan_mappings (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    mode             ENUM('test','live') NOT NULL,
    plan_table       ENUM('plans','hosting_plans') NOT NULL,
    local_plan_id    INT NOT NULL,
    currency         VARCHAR(3) NOT NULL DEFAULT 'USD',
    razorpay_plan_id VARCHAR(64) NOT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_local (mode, plan_table, local_plan_id, currency),
    UNIQUE KEY uq_rzp (mode, razorpay_plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Processed Razorpay webhook deliveries (x-razorpay-event-id)
CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
    event_id     VARCHAR(64) PRIMARY KEY,
    event        VARCHAR(64) NOT NULL,
    entity_id    VARCHAR(64) NULL,
    status       ENUM('processing','processed','failed') NOT NULL DEFAULT 'processing',
    attempts     INT NOT NULL DEFAULT 1,
    last_error   TEXT NULL,
    received_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    processed_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    -- Razorpay payment this invoice was issued for (one invoice per payment)
    gateway_payment_id VARCHAR(64) NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_tenant (tenant_id),
    INDEX idx_status (status),
    UNIQUE KEY uq_gateway_payment (gateway_payment_id)
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
