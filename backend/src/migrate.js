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
    },
    {
        version: 5,
        name: 'add_paystack_columns_to_admin',
        up: async (client) => {
            // Add Paystack columns
            const columnsToAdd = [
                { name: 'paystack_subaccount_code', type: 'VARCHAR(100)' },
                { name: 'paystack_bank_code', type: 'VARCHAR(50)' },
                { name: 'paystack_account_number', type: 'VARCHAR(50)' },
                { name: 'paystack_account_name', type: 'VARCHAR(255)' },
                { name: 'payment_configured', type: 'BOOLEAN DEFAULT FALSE' }
            ];

            for (const col of columnsToAdd) {
                const exists = await client.query(`
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'admin'
                      AND column_name = $1
                `, [col.name]);

                if (exists.rows.length === 0) {
                    await client.query(`
                        ALTER TABLE admin ADD COLUMN ${col.name} ${col.type}
                    `);
                }
            }

            // Create indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_admin_paystack_subaccount_code ON admin(paystack_subaccount_code)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_admin_payment_configured ON admin(payment_configured)
            `);
        }
    },
    {
        version: 6,
        name: 'add_payment_config_audit_trail',
        up: async (client) => {
            await client.query(`
                CREATE TABLE IF NOT EXISTS payment_config_audit (
                    id SERIAL PRIMARY KEY,
                    owner_id INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
                    admin_id INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
                    change_type VARCHAR(50) NOT NULL,
                    old_account_name VARCHAR(255),
                    new_account_name VARCHAR(255),
                    old_bank_code VARCHAR(50),
                    new_bank_code VARCHAR(50),
                    old_account_number VARCHAR(50),
                    new_account_number VARCHAR(50),
                    old_subaccount_code VARCHAR(100),
                    new_subaccount_code VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payment_config_audit_owner_id ON payment_config_audit(owner_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payment_config_audit_admin_id ON payment_config_audit(admin_id)
            `);
        }
    },
    {
        version: 7,
        name: 'add_payment_setup_columns_to_admin',
        up: async (client) => {
            // Add payment setup columns
            const columnsToAdd = [
                { name: 'currency', type: 'VARCHAR(10) DEFAULT \'KES\'' },
                { name: 'payment_type', type: 'VARCHAR(20)' },
                { name: 'provider_code', type: 'VARCHAR(100)' },
                { name: 'provider_name', type: 'VARCHAR(255)' },
                { name: 'account_number', type: 'VARCHAR(100)' },
                { name: 'account_name', type: 'VARCHAR(255)' }
            ];

            for (const col of columnsToAdd) {
                const exists = await client.query(`
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'admin'
                      AND column_name = $1
                `, [col.name]);

                if (exists.rows.length === 0) {
                    await client.query(`
                        ALTER TABLE admin ADD COLUMN ${col.name} ${col.type}
                    `);
                }
            }
        }
    },
    {
        version: 8,
        name: 'add_notification_preferences_and_admin_notifications',
        up: async (client) => {
            // Add notification preference columns to admin table
            const columnsToAdd = [
                { name: 'notify_on_payment', type: 'BOOLEAN DEFAULT TRUE' },
                { name: 'notify_channel', type: 'VARCHAR(20) DEFAULT \'inapp\'' },
                { name: 'notify_on_arrears', type: 'BOOLEAN DEFAULT TRUE' }
            ];

            for (const col of columnsToAdd) {
                const exists = await client.query(`
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'admin'
                      AND column_name = $1
                `, [col.name]);

                if (exists.rows.length === 0) {
                    await client.query(`
                        ALTER TABLE admin ADD COLUMN ${col.name} ${col.type}
                    `);
                }
            }

            // Create admin notifications table
            await client.query(`
                CREATE TABLE IF NOT EXISTS admin_notifications (
                    id SERIAL PRIMARY KEY,
                    owner_id INTEGER REFERENCES admin(id) ON DELETE CASCADE NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    data JSONB,
                    is_read BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Create indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_admin_notifications_owner_id ON admin_notifications(owner_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_admin_notifications_is_read ON admin_notifications(is_read)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at ON admin_notifications(created_at)
            `);
        }
    },
    {
        version: 9,
        name: 'add_critical_performance_indexes',
        up: async (client) => {
            // Tenants Table Indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_tenants_owner_isdeleted 
                ON tenants (owner_id, is_deleted)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_tenants_phone_owner 
                ON tenants (phone, owner_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_tenants_national_id_owner 
                ON tenants (national_id, owner_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_tenants_account_owner 
                ON tenants (account_number, owner_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_tenants_property 
                ON tenants (property_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_tenants_room 
                ON tenants (room_id)
            `);

            // Rooms Table Indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_rooms_property 
                ON rooms (property_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_rooms_status 
                ON rooms (status)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_rooms_property_house 
                ON rooms (property_id, house_no)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_rooms_property_status 
                ON rooms (property_id, status)
            `);

            // Bills Table Indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_bills_tenant 
                ON bills (tenant_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_bills_property 
                ON bills (property_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_bills_paid 
                ON bills (paid)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_bills_due_date 
                ON bills (due_date)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_bills_tenant_paid 
                ON bills (tenant_id, paid)
            `);

            // Payments Table Indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payments_tenant 
                ON payments (tenant_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payments_property 
                ON payments (property_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payments_date 
                ON payments (payment_date)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payments_transaction_id 
                ON payments (transaction_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payments_owner 
                ON payments (owner_id)
            `);

            // Messages Table Indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_messages_owner 
                ON messages (owner_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_messages_tenant 
                ON messages (tenant_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_messages_sent 
                ON messages (sent)
            `);
        }
    },
    {
        version: 10,
        name: 'add_covering_composite_indexes',
        up: async (client) => {
            // Covering indexes for most critical queries
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_bills_owner_status_date 
                ON bills (owner_id, paid, due_date DESC)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_properties_owner_active 
                ON properties (owner_id)
                WHERE is_deleted = false
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_tenants_owner_active 
                ON tenants (owner_id)
                WHERE is_deleted = false
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_payments_owner_date 
                ON payments (owner_id, payment_date DESC)
            `);
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
