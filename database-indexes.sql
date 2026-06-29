-- ==============================================
-- DATABASE INDEXES FOR RENTAL MANAGEMENT SYSTEM
-- Run this in Supabase SQL Editor
-- ==============================================

-- ===== TENANT INDEXES =====
CREATE INDEX IF NOT EXISTS idx_tenant_email ON tenants(email);
CREATE INDEX IF NOT EXISTS idx_tenant_property_id ON tenants(property_id);
CREATE INDEX IF NOT EXISTS idx_tenant_phone ON tenants(phone);
CREATE INDEX IF NOT EXISTS idx_tenant_is_deleted ON tenants(is_deleted);

-- ===== PROPERTY INDEXES =====
CREATE INDEX IF NOT EXISTS idx_property_location ON properties(location);
CREATE INDEX IF NOT EXISTS idx_property_created_at ON properties(created_at);

-- ===== ROOM INDEXES =====
CREATE INDEX IF NOT EXISTS idx_room_property_id ON rooms(property_id);
CREATE INDEX IF NOT EXISTS idx_room_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_room_house_no ON rooms(house_no);
CREATE INDEX IF NOT EXISTS idx_room_type ON rooms(room_type);

-- ===== BILL INDEXES (CRITICAL) =====
CREATE INDEX IF NOT EXISTS idx_bill_tenant_id ON bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bill_property_id ON bills(property_id);
CREATE INDEX IF NOT EXISTS idx_bill_room_id ON bills(room_id);
CREATE INDEX IF NOT EXISTS idx_bill_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bill_created_at ON bills(created_at);
CREATE INDEX IF NOT EXISTS idx_bill_bill_month ON bills(bill_month);
CREATE INDEX IF NOT EXISTS idx_bill_month_year ON bills(month_year);

-- ===== PAYMENT INDEXES (CRITICAL) =====
CREATE INDEX IF NOT EXISTS idx_payment_tenant_id ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payment_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_transaction_id ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_source ON payments(source);

-- ===== MESSAGE INDEXES =====
CREATE INDEX IF NOT EXISTS idx_message_tenant_id ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_admin_id ON messages(admin_id);
CREATE INDEX IF NOT EXISTS idx_message_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_message_is_read ON messages(is_read);

-- ===== PAYMENT REQUESTS INDEX (NEW TABLE) =====
CREATE INDEX IF NOT EXISTS idx_payment_request_checkout_id ON payment_requests(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_payment_request_tenant_id ON payment_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_request_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_request_created_at ON payment_requests(created_at);

-- ===== MPESA CALLBACK INDEXES =====
CREATE INDEX IF NOT EXISTS idx_mpesa_callbacks_processed ON mpesa_callbacks(processed);
CREATE INDEX IF NOT EXISTS idx_mpesa_callbacks_created_at ON mpesa_callbacks(created_at);

-- ===== COMPOSITE INDEXES (Multi-column - for common queries with multiple conditions) =====
CREATE INDEX IF NOT EXISTS idx_bill_tenant_status 
  ON bills(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_tenant_date 
  ON payments(tenant_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_tenant_property_deleted 
  ON tenants(property_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_room_property_status 
  ON rooms(property_id, status);

-- ===== VERIFY ALL INDEXES =====
SELECT schemaname, tablename, indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename, indexname;
