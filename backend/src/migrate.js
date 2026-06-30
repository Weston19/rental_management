/**
 * Migration module with version tracking
 *
 * What it does:
 *  1. Creates migration_history table to track applied migrations
 *  2. Only runs migrations that haven't been applied yet
 *  3. Each migration is wrapped in a transaction and tracked with timestamp
 */
const pool = require('./utils/db');

// Define all migrations with unique versions
const migrations = [
    {
        version: 1,
        name: 'initial_admin_roles_and_owner_id_columns',
        up: async (client) => {
            // 1. Create admin_roles table
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

            // 2. Add owner_id columns to core tables
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
        }
    },
    {
        version: 2,
        name: 'backfill_admin_roles_and_owner_ids',
        up: async (client) => {
            // Register every existing admin as owner of their own workspace
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

            // Backfill unowned data rows for single-admin systems
            if (admins.rows.length === 1) {
                const ownerId = admins.rows[0].id;
                const tables = [
                    'properties', 'tenants', 'bills', 'payments',
                    'expenses', 'financial_summaries', 'messages',
                    'sms_templates', 'unassigned_payments', 'penalty_log'
                ];
                for (const table of tables) {
                    await client.query(
                        `UPDATE ${table} SET owner_id = $1 WHERE owner_id IS NULL`,
                        [ownerId]
                    );
                }
            }
        }
    },
    {
        version: 3,
        name: 'update_sms_templates_unique_constraint',
        up: async (client) => {
            await client.query(`
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'sms_templates_name_key'
                    ) THEN
                        ALTER TABLE sms_templates DROP CONSTRAINT sms_templates_name_key;
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'sms_templates_name_owner_id_key'
                    ) THEN
                        ALTER TABLE sms_templates
                        ADD CONSTRAINT sms_templates_name_owner_id_key UNIQUE (name, owner_id);
                    END IF;
                END $$;
            `);
        }
    },
    {
        version: 4,
        name: 'seed_default_sms_templates',
        up: async (client) => {
            const admins = await client.query(
                'SELECT id FROM admin ORDER BY id'
            );

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
        }
    }
];

async function runMigrations() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create migration history table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS migration_history (
                id          SERIAL PRIMARY KEY,
                version     INTEGER UNIQUE NOT NULL,
                name        VARCHAR(255) NOT NULL,
                applied_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        // Get already applied migrations
        const applied = await client.query('SELECT version FROM migration_history ORDER BY version');
        const appliedVersions = new Set(applied.rows.map(row => row.version));

        // Run only new migrations
        for (const migration of migrations) {
            if (!appliedVersions.has(migration.version)) {
                console.log(`Applying migration ${migration.version}: ${migration.name}`);
                await migration.up(client);
                await client.query(
                    'INSERT INTO migration_history (version, name) VALUES ($1, $2)',
                    [migration.version, migration.name]
                );
                console.log(`✅ Migration ${migration.version} applied successfully`);
            }
        }

        await client.query('COMMIT');
        console.log('✅ All migrations up to date');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('⚠️  Migration error:', err.message);
    } finally {
        client.release();
    }
}

module.exports = runMigrations;
