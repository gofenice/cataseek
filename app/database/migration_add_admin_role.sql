-- Migration: Add role column to tenants table
-- Run this ONCE on the live database before starting the server

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS role ENUM('merchant', 'admin') NOT NULL DEFAULT 'merchant' 
AFTER status;

-- After running this SQL, seed the admin account:
-- npx ts-node src/scripts/seed-admin.ts
