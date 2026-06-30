-- =============================================================
-- MIGRATION 004: Add Payment Setup Columns
-- =============================================================

-- Add new payment setup columns to admin table
ALTER TABLE admin ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'KES';
ALTER TABLE admin ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS provider_code VARCHAR(100);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS provider_name VARCHAR(255);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS account_number VARCHAR(100);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS account_name VARCHAR(255);

-- =============================================================
-- END MIGRATION
-- =============================================================
