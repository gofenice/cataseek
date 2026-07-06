-- Task 6: Create tenant_settings table to store design settings from Dashboard
-- Run this on the live DB before deploying the backend

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id     INT PRIMARY KEY,
  theme_color   VARCHAR(20)                        DEFAULT '#4F46E5',
  icon_color    VARCHAR(20)                        DEFAULT '#4F46E5',
  icon_type     ENUM('Icon','Text')                DEFAULT 'Icon',
  modal_size    ENUM('Large','Medium','Small')      DEFAULT 'Large',
  icon_position ENUM('Left','Right')               DEFAULT 'Right',
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
