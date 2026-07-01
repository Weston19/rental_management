-- =============================================================
-- MIGRATION 005: Add Notification Preferences & Notifications Table
-- =============================================================

-- Add notification preference columns to admin table
ALTER TABLE admin ADD COLUMN IF NOT EXISTS notify_on_payment BOOLEAN DEFAULT TRUE;
ALTER TABLE admin ADD COLUMN IF NOT EXISTS notify_channel VARCHAR(20) DEFAULT 'inapp'; -- 'inapp', 'sms', 'email', 'all'
ALTER TABLE admin ADD COLUMN IF NOT EXISTS notify_on_arrears BOOLEAN DEFAULT TRUE;

-- Create admin notifications table
CREATE TABLE IF NOT EXISTS admin_notifications (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES admin(id) ON DELETE CASCADE NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'payment_received', 'payment_failed', 'new_tenant', 'arrears', etc.
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB, -- Additional data like payment_id, tenant_id, property_id, etc.
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for fast retrieval of notifications
CREATE INDEX IF NOT EXISTS idx_admin_notifications_owner_id ON admin_notifications(owner_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_is_read ON admin_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at ON admin_notifications(created_at);
