/**
 * Auto-migration module — idempotent, safe to run on every cold start.
 *
 * What it does:
 *  1. Creates admin_roles table if missing
 *  2. Adds owner_id column to each core table if missing
 *  3. Backfills existing admin accounts as owners of their own workspace
 *  4. For single-admin systems: stamps all unowned rows with that admin's id
 *  5. Seeds default SMS templates per owner if none exist
 */
const pool = require('./db');

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ── 1. admin_roles table ─────────────────────────────────────────────
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_roles (
                id         SERIAL PRIMARY KEY,
                admin_id   INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
                owner_id   INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
                email      VARCHAR(255) NOT NULL,
                name       VARCHAR(100),
                role       VARCHAR(20) NOT NULL DEFAULT 'viewer'
                           CHECK (role IN ('owner', 'manager', 'viewer')),
                is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(admin_id, owner_id)
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_admin_roles_owner_id ON admin_roles(owner_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_admin_roles_admin_id ON admin_roles(admin_id)
        `);

        // ── 2. owner_id columns on core tables ───────────────────────────────
        const tables = [
            'properties', 'tenants', 'bills', 'payments',
            'expenses', 'financial_summaries', 'messages',
            'sms_templates', 'unassigned_payments', 'penalty_log'
        ];
        for (const table of tables) {
            const exists = await client.query(`
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name   = $1
                  AND column_name  = 'owner_id'
            `, [table]);
            if (exists.rows.length === 0) {
                await client.query(
                    `ALTER TABLE ${table} ADD COLUMN owner_id INTEGER REFERENCES admin(id)`
                );
                await client.query(
                    `CREATE INDEX IF NOT EXISTS idx_${table}_owner_id ON ${table}(owner_id)`
                );
            }
        }

        // ── 3. Register every existing admin as owner of their own workspace ─
        const admins = await client.query(
            'SELECT id, email, company_name FROM admin ORDER BY id'
        );

        for (const admin of admins.rows) {
            await client.query(`
                INSERT INTO admin_roles (admin_id, owner_id, email, name, role)
                VALUES ($1, $1, $2, $3, 'owner')
                ON CONFLICT (admin_id, owner_id) DO NOTHING
            `, [admin.id, admin.email, admin.company_name || admin.email]);
        }

        // ── 4. Backfill unowned data rows ────────────────────────────────────
        // Only safe when there is exactly ONE admin — all orphaned rows belong
        // to that admin.  With multiple admins we can't guess ownership, so we
        // skip the backfill and leave owner_id NULL (routes handle NULL safely).
        if (admins.rows.length === 1) {
            const ownerId = admins.rows[0].id;
            for (const table of tables) {
                await client.query(
                    `UPDATE ${table} SET owner_id = $1 WHERE owner_id IS NULL`,
                    [ownerId]
                );
            }
        }

        // ── 5. Seed default SMS templates for owners who have none ──────────
        // First: drop the old global unique constraint on name if it exists,
        // and add a per-owner unique constraint instead
        await client.query(`
            DO $$
            BEGIN
                -- Drop old single-column unique constraint if present
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'sms_templates_name_key'
                ) THEN
                    ALTER TABLE sms_templates DROP CONSTRAINT sms_templates_name_key;
                END IF;

                -- Add per-owner unique constraint if not already there
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'sms_templates_name_owner_id_key'
                ) THEN
                    ALTER TABLE sms_templates
                    ADD CONSTRAINT sms_templates_name_owner_id_key UNIQUE (name, owner_id);
                END IF;
            END $$;
        `);

        for (const admin of admins.rows) {
            const existing = await client.query(
                'SELECT id FROM sms_templates WHERE owner_id = $1 LIMIT 1',
                [admin.id]
            );
            if (existing.rows.length === 0) {
                await client.query(`
                    INSERT INTO sms_templates (name, template_text, description, owner_id)
                    VALUES
                    ('bill_creation',
                     'Hello {name}, your {month} bill for {item} is KES {amount}, previous balance KES {balance}, total bill KES {total}. Due date is {due_date}.',
                     'Sent when a bill is created', $1),
                    ('penalty_notification',
                     'Hello {name}, a late payment penalty of KES {penalty} has been awarded. Total balance is now KES {total}.',
                     'Sent when penalty is awarded', $1),
                    ('rent_reminder',
                     'Hello {name}, your rent of KES {balance} for {month} is due on {due_date}. Please pay on time to avoid penalties.',
                     'Sent as a reminder', $1),
                    ('payment_receipt',
                     'Hello {name}, we have received your payment of KES {amount} for {payment_type} on {date}. Your current balance is KES {balance}. Thank you.',
                     'Sent when payment is recorded', $1)
                    ON CONFLICT (name, owner_id) DO NOTHING
                `, [admin.id]);
            }
        }

        await client.query('COMMIT');
        console.log('✅ Migrations applied successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('⚠️  Migration error (non-fatal):', err.message);
        // Don't rethrow — let the server start even with a partial migration
    } finally {
        client.release();
    }
}

module.exports = runMigrations;
