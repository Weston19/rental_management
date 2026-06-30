
-- =============================================================
-- MIGRATION 003: Paystack Integration
-- =============================================================
-- Adds Paystack-specific columns to admin table for subaccount management
-- =============================================================

-- Add Paystack columns to admin table
ALTER TABLE admin ADD COLUMN IF NOT EXISTS paystack_subaccount_code VARCHAR(100);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS paystack_bank_code VARCHAR(50);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS paystack_account_number VARCHAR(50);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS paystack_account_name VARCHAR(255);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS payment_configured BOOLEAN DEFAULT FALSE;

-- Create indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_admin_paystack_subaccount_code ON admin(paystack_subaccount_code);
CREATE INDEX IF NOT EXISTS idx_admin_payment_configured ON admin(payment_configured);

-- =============================================================
-- END MIGRATION 003
-- =============================================================
