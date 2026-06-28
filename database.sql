
-- 1. ADMIN TABLE
CREATE TABLE IF NOT EXISTS admin (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. PROPERTIES TABLE
CREATE TABLE IF NOT EXISTS properties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    location TEXT NOT NULL,
    landlord_name VARCHAR(255) NOT NULL,
    total_rooms INTEGER NOT NULL DEFAULT 0,
    occupied_rooms INTEGER NOT NULL DEFAULT 0,
    billing_day INTEGER NOT NULL DEFAULT 1,
    penalty_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. ROOMS TABLE
CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    house_no VARCHAR(100) NOT NULL,
    room_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'vacant',
    deposit DECIMAL(10,2) NOT NULL,
    rent DECIMAL(10,2) NOT NULL,
    floor_number INTEGER DEFAULT 0,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(property_id, house_no)
);

-- 4. TENANTS TABLE
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    national_id VARCHAR(50) NOT NULL,
    front_id_image TEXT,
    back_id_image TEXT,
    profile_image TEXT,
    property_id INTEGER REFERENCES properties(id),
    room_id INTEGER REFERENCES rooms(id),
    account_number VARCHAR(100) NOT NULL UNIQUE,
    move_in_date DATE NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    deposit_paid DECIMAL(10,2) DEFAULT 0,
    deposit_balance DECIMAL(10,2) DEFAULT 0,
    balance DECIMAL(10,2) DEFAULT 0,
    password_hash VARCHAR(255),
    portal_enabled BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. BILLS TABLE
CREATE TABLE IF NOT EXISTS bills (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    bill_month DATE NOT NULL,
    total_bill DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'not_paid',
    previous_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
    penalty_amount DECIMAL(10,2) DEFAULT 0,
    penalty_awarded_date DATE,
    bill_type VARCHAR(50) DEFAULT 'rent',
    parent_bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
    month_year VARCHAR(7),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 6. BILL ITEMS TABLE
CREATE TABLE IF NOT EXISTS bill_items (
    id SERIAL PRIMARY KEY,
    bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
    item_name VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 7. PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_type VARCHAR(50) NOT NULL DEFAULT 'rent',
    transaction_id VARCHAR(255) UNIQUE,
    notes TEXT,
    source VARCHAR(20) DEFAULT 'manual',
    receipt_sent BOOLEAN DEFAULT FALSE,
    receipt_sent_at TIMESTAMP,
    edited_by VARCHAR(255),
    edit_reason TEXT,
    edit_count INTEGER DEFAULT 0,
    bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 8. RENT HISTORY TABLE
CREATE TABLE IF NOT EXISTS rent_history (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    month_year DATE NOT NULL,
    rent_amount DECIMAL(10,2) NOT NULL,
    penalty_amount DECIMAL(10,2) DEFAULT 0,
    additional_bills_total DECIMAL(10,2) DEFAULT 0,
    total_expected DECIMAL(10,2) NOT NULL,
    total_paid DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. EXPENSES TABLE
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    category VARCHAR(100) NOT NULL,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'finished',
    file_url TEXT,
    description TEXT,
    created_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 10. ADDITIONAL BILLS TABLE (Tenant extra charges)
CREATE TABLE IF NOT EXISTS tenant_additional_bills (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    bill_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 11. UNASSIGNED PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS unassigned_payments (
    id SERIAL PRIMARY KEY,
    account_number VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    transaction_id VARCHAR(255),
    phone_number VARCHAR(20),
    payment_date TIMESTAMP DEFAULT NOW(),
    assigned_to_tenant_id INTEGER REFERENCES tenants(id),
    assigned_by VARCHAR(255),
    assigned_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 12. PENALTY LOG TABLE
CREATE TABLE IF NOT EXISTS penalty_log (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    bill_id INTEGER REFERENCES bills(id),
    amount DECIMAL(10,2) NOT NULL,
    awarded_date DATE NOT NULL,
    month_year DATE NOT NULL,
    message_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 13. M-PESA TABLES
CREATE TABLE IF NOT EXISTS mpesa_callbacks (
    id SERIAL PRIMARY KEY,
    raw_data JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mpesa_webhook_queue (
    id SERIAL PRIMARY KEY,
    payload JSONB NOT NULL,
    attempts INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP
);

-- 14. FINANCIAL SUMMARIES TABLES
CREATE TABLE IF NOT EXISTS financial_summaries (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    month_year DATE NOT NULL,
    commission_payable DECIMAL(10,2) DEFAULT 0,
    collections_office DECIMAL(10,2) DEFAULT 0,
    collections_landlord DECIMAL(10,2) DEFAULT 0,
    total_collections DECIMAL(10,2) DEFAULT 0,
    total_expenses DECIMAL(10,2) DEFAULT 0,
    total_deductions DECIMAL(10,2) DEFAULT 0,
    net_rent DECIMAL(10,2) DEFAULT 0,
    total_net_rent DECIMAL(10,2) DEFAULT 0,
    deposited_date DATE,
    notes TEXT,
    created_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_summary_rooms (
    id SERIAL PRIMARY KEY,
    summary_id INTEGER REFERENCES financial_summaries(id) ON DELETE CASCADE,
    room_id INTEGER REFERENCES rooms(id),
    house_no VARCHAR(100),
    status VARCHAR(50),
    amount DECIMAL(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS financial_summary_expenses (
    id SERIAL PRIMARY KEY,
    summary_id INTEGER REFERENCES financial_summaries(id) ON DELETE CASCADE,
    expense_id INTEGER REFERENCES expenses(id),
    category VARCHAR(100),
    amount DECIMAL(10,2) DEFAULT 0
);

-- 15. SMS TEMPLATES TABLE
CREATE TABLE IF NOT EXISTS sms_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    template_text TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 16. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER REFERENCES admin(id),
    recipient_type VARCHAR(50) NOT NULL,
    recipient_id INTEGER,
    template_used VARCHAR(100),
    subject VARCHAR(255),
    message TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'unsent',
    sent_at TIMESTAMP,
    created_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_recipients (
    id SERIAL PRIMARY KEY,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    tenant_id INTEGER REFERENCES tenants(id),
    phone VARCHAR(20),
    status VARCHAR(50),
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 17. INBOX TABLE (Incoming messages from tenants)
CREATE TABLE IF NOT EXISTS inbox (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id),
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    replied_to INTEGER REFERENCES messages(id),
    created_at TIMESTAMP DEFAULT NOW()
);


-- CREATE ALL INDEXES FOR PERFORMANCE

CREATE INDEX IF NOT EXISTS idx_tenants_account_number ON tenants(account_number);
CREATE INDEX IF NOT EXISTS idx_tenants_phone ON tenants(phone);
CREATE INDEX IF NOT EXISTS idx_tenants_is_deleted ON tenants(is_deleted);
CREATE INDEX IF NOT EXISTS idx_tenants_room_id ON tenants(room_id);
CREATE INDEX IF NOT EXISTS idx_rooms_property_id ON rooms(property_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_bills_tenant_id ON bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bills_property_id ON bills(property_id);
CREATE INDEX IF NOT EXISTS idx_bills_bill_month ON bills(bill_month);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_rent_history_tenant_id ON rent_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_property_id ON expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_financial_summaries_property_id ON financial_summaries(property_id);
CREATE INDEX IF NOT EXISTS idx_financial_summaries_month_year ON financial_summaries(month_year);
CREATE INDEX IF NOT EXISTS idx_financial_summary_rooms_summary_id ON financial_summary_rooms(summary_id);
CREATE INDEX IF NOT EXISTS idx_financial_summary_expenses_summary_id ON financial_summary_expenses(summary_id);
CREATE INDEX IF NOT EXISTS idx_penalty_log_tenant_id ON penalty_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_penalty_log_month_year ON penalty_log(month_year);
CREATE INDEX IF NOT EXISTS idx_tenant_bills_tenant_id ON tenant_additional_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_tenant_id ON inbox(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inbox_is_read ON inbox(is_read);
CREATE INDEX IF NOT EXISTS idx_unassigned_payments_created_at ON unassigned_payments(created_at);
CREATE INDEX IF NOT EXISTS idx_mpesa_callbacks_created_at ON mpesa_callbacks(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_bill_id ON payments(bill_id);

-- INSERT DEFAULT SMS TEMPLATES


INSERT INTO sms_templates (name, template_text, description) VALUES
('bill_creation', 'Hello {name}, your {month} bill for {item} is KES {amount}, previous balance KES {balance}, total bill KES {total}. Due date is {due_date}.', 'Sent when a bill is created'),
('penalty_notification', 'Hello {name}, this is a reminder that your rent was overdue on {due_date}. A late payment penalty of KES {penalty} has been awarded. Total balance is now KES {total}. Payment instructions: Rent: {room_no}, Penalty: P{room_no}, Deposit: D{room_no}.', 'Sent when penalty is awarded'),
('rent_reminder', 'Hello {name}, this is to remind you that your rent payment of {month} amount {balance} is due on {due_date}. Please make payment on time to avoid penalties.', 'Sent as a reminder before due date'),
('payment_receipt', 'Hello {name}, we have received your payment of KES {amount} for {payment_type} on {date}. Your current balance is KES {balance}. Thank you for your payment.', 'Sent when payment is recorded')
ON CONFLICT (name) DO NOTHING;


-- CREATE DATABASE TRIGGER FOR TENANT BALAN

CREATE OR REPLACE FUNCTION update_tenant_balance()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE tenants 
    SET balance = (
        SELECT COALESCE(SUM(total_bill - total_paid), 0)
        FROM bills 
        WHERE tenant_id = NEW.tenant_id
    )
    WHERE id = NEW.tenant_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_balance ON bills;
CREATE TRIGGER trigger_update_balance
AFTER INSERT OR UPDATE OF total_bill, total_paid ON bills
FOR EACH ROW
EXECUTE FUNCTION update_tenant_balance();

-- UPDATE EXISTING TENANT BALANCES

UPDATE tenants t SET balance = (
    SELECT COALESCE(SUM(b.total_bill - b.total_paid), 0)
    FROM bills b
    WHERE b.tenant_id = t.id
);

-- VERIFY ALL TABLES CREATED

SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;