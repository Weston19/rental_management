-- =============================================================
-- MIGRATION 006: Add Critical Performance Indexes
-- =============================================================

-- 1. Tenants Table Indexes (Most Queries are Owner-scoped)
CREATE INDEX IF NOT EXISTS idx_tenants_owner_isdeleted ON tenants (owner_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_tenants_phone_owner ON tenants (phone, owner_id);
CREATE INDEX IF NOT EXISTS idx_tenants_national_id_owner ON tenants (national_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_tenants_account_owner ON tenants (account_number, owner_id);
CREATE INDEX IF NOT EXISTS idx_tenants_property ON tenants (property_id);
CREATE INDEX IF NOT EXISTS idx_tenants_room ON tenants (room_id);

-- 2. Rooms Table Indexes
CREATE INDEX IF NOT EXISTS idx_rooms_property ON rooms (property_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms (status);
CREATE INDEX IF NOT EXISTS idx_rooms_property_house ON rooms (property_id, house_no);
CREATE INDEX IF NOT EXISTS idx_rooms_property_status ON rooms (property_id, status);

-- 3. Bills Table Indexes
CREATE INDEX IF NOT EXISTS idx_bills_tenant ON bills (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bills_property ON bills (property_id);
CREATE INDEX IF NOT EXISTS idx_bills_paid ON bills (paid);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills (due_date);
CREATE INDEX IF NOT EXISTS idx_bills_tenant_paid ON bills (tenant_id, paid);

-- 4. Payments Table Indexes
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_property ON payments (property_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments (payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments (transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_owner ON payments (owner_id);

-- 5. Properties Table Indexes
CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties (owner_id);

-- 6. Messages Table Indexes
CREATE INDEX IF NOT EXISTS idx_messages_owner ON messages (owner_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages (sent);
