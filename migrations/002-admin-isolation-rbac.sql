-- =============================================================
-- MIGRATION 002: Admin Isolation + Role-Based Access Control
-- =============================================================
-- Adds admin_id to all core tables so each admin only sees their
-- own data. Introduces an admin_roles table for owner/manager/viewer.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. ADMIN ROLES TABLE
--    owner   – full access, created on signup, cannot be deleted
--    manager – can do everything except delete payments/summaries
--    viewer  – read-only access across the board
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_roles (
    id          SERIAL PRIMARY KEY,
    admin_id    INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
    owner_id    INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,  -- which owner this role belongs to
    email       VARCHAR(255) NOT NULL,
    name        VARCHAR(100),
    role        VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'manager', 'viewer')),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(admin_id, owner_id)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_admin_roles_owner_id  ON admin_roles(owner_id);
CREATE INDEX IF NOT EXISTS idx_admin_roles_admin_id  ON admin_roles(admin_id);

-- ---------------------------------------------------------------
-- 2. ADD owner_id TO CORE TABLES
--    owner_id always points to the root admin (owner).
--    Managers/viewers share the same owner_id as their owner.
-- ---------------------------------------------------------------

-- properties
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- bills
ALTER TABLE bills ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- expenses
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- financial_summaries
ALTER TABLE financial_summaries ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- sms_templates
ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- unassigned_payments
ALTER TABLE unassigned_payments ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- penalty_log (derived from bills, same owner)
ALTER TABLE penalty_log ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES admin(id);

-- ---------------------------------------------------------------
-- 3. BACK-FILL EXISTING DATA
--    If there is only one admin in the system, assign all rows to
--    that admin. Safe to run on a fresh or single-admin database.
-- ---------------------------------------------------------------
DO $$
DECLARE
    first_admin_id INTEGER;
BEGIN
    SELECT id INTO first_admin_id FROM admin ORDER BY id LIMIT 1;

    IF first_admin_id IS NOT NULL THEN
        UPDATE properties           SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE tenants              SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE bills                SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE payments             SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE expenses             SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE financial_summaries  SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE messages             SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE sms_templates        SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE unassigned_payments  SET owner_id = first_admin_id WHERE owner_id IS NULL;
        UPDATE penalty_log          SET owner_id = first_admin_id WHERE owner_id IS NULL;

        -- Register the first admin as their own owner
        INSERT INTO admin_roles (admin_id, owner_id, email, name, role)
        SELECT a.id, a.id, a.email, a.company_name, 'owner'
        FROM admin a
        WHERE a.id = first_admin_id
        ON CONFLICT (admin_id, owner_id) DO NOTHING;
    END IF;
END $$;

-- ---------------------------------------------------------------
-- 4. PERFORMANCE INDEXES ON owner_id COLUMNS
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_properties_owner_id          ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_id             ON tenants(owner_id);
CREATE INDEX IF NOT EXISTS idx_bills_owner_id               ON bills(owner_id);
CREATE INDEX IF NOT EXISTS idx_payments_owner_id            ON payments(owner_id);
CREATE INDEX IF NOT EXISTS idx_expenses_owner_id            ON expenses(owner_id);
CREATE INDEX IF NOT EXISTS idx_financial_summaries_owner_id ON financial_summaries(owner_id);
CREATE INDEX IF NOT EXISTS idx_messages_owner_id            ON messages(owner_id);
CREATE INDEX IF NOT EXISTS idx_sms_templates_owner_id       ON sms_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_unassigned_payments_owner_id ON unassigned_payments(owner_id);
CREATE INDEX IF NOT EXISTS idx_penalty_log_owner_id         ON penalty_log(owner_id);
