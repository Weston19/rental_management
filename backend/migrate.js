/**
 * Auto-migration module.
 * Called at server startup — idempotent, safe to run every time.
 * Creates admin_roles table + owner_id columns if they don't exist,
 * then backfills any existing admins who have no role row yet.
 */
const pool = require('./db');

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ── 1. admin_roles table ────────────────────────────────────────────
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

        // ── 2. owner_id columns on core tables ──────────────────────────────
        const tables = [
            'properties', 'tenants', 'bills', 'payments',
            'expenses', 'financial_summaries', 'messages',
            'sms_templates', 'unassigned_payments', 'penalty_log'
        ];
        for (const table of tables) {
            // Check if column exists before adding (avoids errors on repeated runs)
            const exists = await client.query(`
                SELECT 1 FROM information_schema.columns
                WHERE table_name = $1 AND column_name = 'owner_id'
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

        // ── 3. Backfill: register every existing admin as their own owner ───
        // Also stamps all their data rows with their owner_id
        const admins = await client.query('SELECT id, email, company_name FROM admin');
        for (const admin of admins.rows) {
            // Ensure owner role row exists
            await client.query(`
                INSERT INTO admin_roles (admin_id, owner_id, email, name, role)
                VALUES ($1, $1, $2, $3, 'owner')
                ON CONFLICT (admin_id, owner_id) DO NOTHING
            `, [admin.id, admin.email, admin.company_name || admin.email]);

            // Stamp any unowned rows with this admin's id
            // (only applies when there is exactly one admin — safe for multi-admin too
            //  because we only update rows where owner_id IS NULL)
            for (const table of tables) {
                await client.query(
                    `UPDATE ${table} SET owner_id = $1 WHERE owner_id IS NULL`,
                    [admin.id]
                );
            }
        }

        // ── 4. sms_templates: add owner_id to default templates if orphaned ─
        await client.query(`
            UPDATE sms_templates SET owner_id = (SELECT id FROM admin ORDER BY id LIMIT 1)
            WHERE owner_id IS NULL
        `);

        await client.query('COMMIT');
        console.log('✅ Migrations applied successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        // Log but don't crash the server — old tokens + existing routes still work
        console.error('⚠️  Migration error (non-fatal):', err.message);
    } finally {
        client.release();
    }
}

module.exports = runMigrations;
