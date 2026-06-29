-- ==============================================
-- MIGRATION 001: Add Payment Requests Table
-- ==============================================

-- Create payment_requests table to track STK Push requests
CREATE TABLE IF NOT EXISTS payment_requests (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER,
    checkout_request_id VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    result_code INTEGER,
    result_desc TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for this table
CREATE INDEX IF NOT EXISTS idx_payment_request_checkout_id ON payment_requests(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_payment_request_tenant_id ON payment_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_request_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_request_created_at ON payment_requests(created_at);

-- Add foreign key constraint safely
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE payment_requests 
        ADD CONSTRAINT fk_payment_request_tenant 
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
    EXCEPTION
        WHEN duplicate_table OR duplicate_object THEN
            NULL; -- Ignore if constraint already exists
    END;
END $$;
