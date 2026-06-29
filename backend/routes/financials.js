const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcrypt');

const router = express.Router();

// ========== SUMMARY ENDPOINTS ==========

// Get all summaries
router.get('/summaries', auth, async (req, res) => {
    try {
        const { property_id, month } = req.query;
        let query = `
            SELECT fs.*, p.name as property_name, p.landlord_name
            FROM financial_summaries fs
            LEFT JOIN properties p ON fs.property_id = p.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        if (property_id) { query += ` AND fs.property_id = $${paramIndex++}`; params.push(property_id); }
        if (month) { query += ` AND TO_CHAR(fs.month_year, 'YYYY-MM') = $${paramIndex++}`; params.push(month); }
        query += ` ORDER BY fs.month_year DESC, fs.id DESC`;
        
        const result = await pool.query(query, params);
        for (const summary of result.rows) {
            const rooms = await pool.query('SELECT * FROM financial_summary_rooms WHERE summary_id = $1 ORDER BY house_no', [summary.id]);
            const expenses = await pool.query('SELECT * FROM financial_summary_expenses WHERE summary_id = $1 ORDER BY category', [summary.id]);
            summary.rooms = rooms.rows;
            summary.expenses = expenses.rows;
        }
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single summary
router.get('/summaries/:id', auth, async (req, res) => {
    try {
        const summaryResult = await pool.query(`
            SELECT fs.*, p.name as property_name, p.landlord_name
            FROM financial_summaries fs
            LEFT JOIN properties p ON fs.property_id = p.id
            WHERE fs.id = $1
        `, [req.params.id]);
        if (summaryResult.rows.length === 0) return res.status(404).json({ error: 'Summary not found' });
        
        const rooms = await pool.query('SELECT * FROM financial_summary_rooms WHERE summary_id = $1 ORDER BY house_no', [req.params.id]);
        const expenses = await pool.query('SELECT * FROM financial_summary_expenses WHERE summary_id = $1 ORDER BY category', [req.params.id]);
        res.json({ ...summaryResult.rows[0], rooms: rooms.rows, expenses: expenses.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Generate summary
router.post('/summaries/generate', auth, async (req, res) => {
    const { property_id, month_year, commission_payable, collections_landlord, password } = req.body;
    
    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        
        const targetMonth = new Date(month_year);
        
        const property = await pool.query('SELECT * FROM properties WHERE id = $1', [property_id]);
        if (property.rows.length === 0) return res.status(404).json({ error: 'Property not found' });
        
        const rooms = await pool.query(`
            SELECT r.*, t.id as tenant_id, t.first_name, t.last_name
            FROM rooms r
            LEFT JOIN tenants t ON r.id = t.room_id AND t.is_deleted = FALSE
            WHERE r.property_id = $1 ORDER BY r.house_no
        `, [property_id]);
        
        const payments = await pool.query(`
            SELECT p.amount, r.house_no
            FROM payments p
            JOIN tenants t ON p.tenant_id = t.id
            JOIN rooms r ON t.room_id = r.id
            WHERE t.property_id = $1 AND p.payment_type = 'rent' AND DATE_TRUNC('month', p.payment_date) = DATE_TRUNC('month', $2::date)
        `, [property_id, targetMonth]);

        const paymentMap = {};
        payments.rows.forEach(p => { paymentMap[p.house_no] = (paymentMap[p.house_no] || 0) + parseFloat(p.amount); });

        let collections_office = 0;
        const roomStatuses = [];
        for (const room of rooms.rows) {
            const hasTenant = room.tenant_id !== null;
            const paymentAmount = paymentMap[room.house_no] || 0;
            let status = '', amount = 0;
            if (!hasTenant) { status = 'VACANT'; amount = 0; }
            else if (paymentAmount > 0) { status = 'PAID'; amount = paymentAmount; collections_office += paymentAmount; }
            else { status = 'N.P'; amount = 0; }
            roomStatuses.push({ room_id: room.id, house_no: room.house_no, status: status, amount: amount });
        }

        const expenses = await pool.query(`
            SELECT * FROM expenses WHERE property_id = $1 AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', $2::date)
        `, [property_id, targetMonth]);
        
        const total_expenses = expenses.rows.reduce((sum, e) => sum + parseFloat(e.amount), 0);
        const total_collections = collections_office + (parseFloat(collections_landlord) || 0);
        const total_deductions = total_expenses + (parseFloat(commission_payable) || 0);
        const net_rent = total_collections - total_deductions;
        
        const summaryResult = await pool.query(
            `INSERT INTO financial_summaries (property_id, month_year, commission_payable, collections_office, collections_landlord,
             total_collections, total_expenses, total_deductions, net_rent, total_net_rent, deposited_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [property_id, targetMonth, commission_payable || 0, collections_office, collections_landlord || 0,
             total_collections, total_expenses, total_deductions, net_rent, net_rent, new Date(), req.adminId]
        );
        
        const summaryId = summaryResult.rows[0].id;
        for (const room of roomStatuses) {
            await pool.query('INSERT INTO financial_summary_rooms (summary_id, room_id, house_no, status, amount) VALUES ($1, $2, $3, $4, $5)',
                [summaryId, room.room_id, room.house_no, room.status, room.amount]);
        }
        for (const expense of expenses.rows) {
            await pool.query('INSERT INTO financial_summary_expenses (summary_id, expense_id, category, amount) VALUES ($1, $2, $3, $4)',
                [summaryId, expense.id, expense.category, expense.amount]);
        }
        
        res.json(summaryResult.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update summary
router.put('/summaries/:id', auth, async (req, res) => {
    const { commission_payable, collections_landlord, deposited_date, notes, rooms, expenses, password } = req.body;
    
    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        
        const current = await pool.query('SELECT collections_office FROM financial_summaries WHERE id = $1', [req.params.id]);
        const collections_office = parseFloat(current.rows[0].collections_office) || 0;
        const total_collections = collections_office + (parseFloat(collections_landlord) || 0);
        
        let total_expenses = 0;
        if (expenses && expenses.length > 0) {
            total_expenses = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        }
        
        const total_deductions = total_expenses + (parseFloat(commission_payable) || 0);
        const net_rent = total_collections - total_deductions;
        
        const result = await pool.query(
            `UPDATE financial_summaries SET commission_payable = $1, collections_landlord = $2, total_collections = $3,
             total_expenses = $4, total_deductions = $5, net_rent = $6, total_net_rent = $7,
             deposited_date = $8, notes = $9, updated_at = NOW() WHERE id = $10 RETURNING *`,
            [commission_payable || 0, collections_landlord || 0, total_collections,
             total_expenses, total_deductions, net_rent, net_rent,
             deposited_date, notes, req.params.id]
        );
        
        if (rooms && rooms.length > 0) {
            await pool.query('DELETE FROM financial_summary_rooms WHERE summary_id = $1', [req.params.id]);
            for (const room of rooms) {
                await pool.query('INSERT INTO financial_summary_rooms (summary_id, room_id, house_no, status, amount) VALUES ($1, $2, $3, $4, $5)',
                    [req.params.id, room.room_id, room.house_no, room.status, room.amount]);
            }
        }
        if (expenses && expenses.length > 0) {
            await pool.query('DELETE FROM financial_summary_expenses WHERE summary_id = $1', [req.params.id]);
            for (const expense of expenses) {
                await pool.query('INSERT INTO financial_summary_expenses (summary_id, expense_id, category, amount) VALUES ($1, $2, $3, $4)',
                    [req.params.id, expense.expense_id, expense.category, expense.amount]);
            }
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete summary
router.delete('/summaries/:id', auth, async (req, res) => {
    const { password } = req.body;
    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        await pool.query('DELETE FROM financial_summaries WHERE id = $1', [req.params.id]);
        res.json({ message: 'Summary deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== EXPENSES ENDPOINTS ==========

// Get expenses
router.get('/expenses', auth, async (req, res) => {
    try {
        const { start_date, end_date, property_id, category, status } = req.query;
        let query = `
            SELECT e.*, p.name as property_name, r.house_no as unit_name
            FROM expenses e
            LEFT JOIN properties p ON e.property_id = p.id
            LEFT JOIN rooms r ON e.room_id = r.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        if (start_date) { query += ` AND e.expense_date >= $${paramIndex++}`; params.push(start_date); }
        if (end_date) { query += ` AND e.expense_date <= $${paramIndex++}`; params.push(end_date); }
        if (property_id) { query += ` AND e.property_id = $${paramIndex++}`; params.push(property_id); }
        if (category) { query += ` AND e.category = $${paramIndex++}`; params.push(category); }
        if (status) { query += ` AND e.status = $${paramIndex++}`; params.push(status); }
        query += ` ORDER BY e.expense_date DESC, e.id DESC`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add expense
router.post('/expenses', auth, async (req, res) => {
    const { property_id, room_id, amount, category, expense_date, status, description, password } = req.body;
    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        
        const result = await pool.query(
            `INSERT INTO expenses (property_id, room_id, amount, category, expense_date, status, description, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [property_id, room_id || null, amount, category, expense_date, status || 'finished', description, req.adminId]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update expense
router.put('/expenses/:id', auth, async (req, res) => {
    const { property_id, room_id, amount, category, expense_date, status, description, password } = req.body;
    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        
        const result = await pool.query(
            `UPDATE expenses SET property_id = $1, room_id = $2, amount = $3, category = $4,
             expense_date = $5, status = $6, description = $7 WHERE id = $8 RETURNING *`,
            [property_id, room_id || null, amount, category, expense_date, status, description, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete expense
router.delete('/expenses/:id', auth, async (req, res) => {
    const { password } = req.body;
    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
        res.json({ message: 'Expense deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get expense categories
router.get('/expense-categories', auth, async (req, res) => {
    const categories = [
        'Repairs & Maintenance', 'Utilities (Water/Electricity)', 'Cleaning Services',
        'Security Services', 'Garbage Collection', 'Commission', 'Insurance',
        'Legal Fees', 'Marketing/Advertising', 'Furniture & Equipment',
        'Painting', 'Plumbing', 'Electrical', 'Gardening', 'Other'
    ];
    res.json(categories);
});

// Get tenant list report
router.get('/tenant-list', auth, async (req, res) => {
    try {
        const { property_id, month, year } = req.query;
        const now = new Date();
        const targetMonth = year && month ? new Date(parseInt(year), parseInt(month) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
        
        let query = `
            SELECT 
                p.id as property_id,
                p.name as property_name,
                p.landlord_name as manager_name,
                r.id as room_id,
                r.house_no as room_number,
                r.room_type,
                r.floor_number,
                r.rent as rent_amount,
                r.deposit as deposit_required,
                t.id as tenant_id,
                t.first_name,
                t.last_name,
                t.phone,
                t.account_number,
                COALESCE(t.deposit_paid, 0) as deposit_paid,
                COALESCE((
                    SELECT SUM(amount) FROM payments 
                    WHERE tenant_id = t.id 
                    AND payment_type = 'rent'
                    AND DATE_TRUNC('month', payment_date) = DATE_TRUNC('month', $1::date)
                ), 0) as rent_paid,
                COALESCE((
                    SELECT SUM(amount) FROM payments 
                    WHERE tenant_id = t.id 
                    AND payment_type = 'deposit'
                ), 0) as deposit_paid_total,
                COALESCE((
                    SELECT SUM(amount) FROM payments 
                    WHERE tenant_id = t.id 
                    AND payment_type = 'penalty'
                ), 0) as penalty_paid_total,
                COALESCE(b.total_bill, 0) as total_bill,
                COALESCE(b.total_paid, 0) as total_paid,
                COALESCE(b.penalty_amount, 0) as penalty_awarded
            FROM properties p
            LEFT JOIN rooms r ON p.id = r.property_id
            LEFT JOIN tenants t ON r.id = t.room_id AND t.is_deleted = FALSE
            LEFT JOIN bills b ON t.id = b.tenant_id AND DATE_TRUNC('month', b.bill_month) = DATE_TRUNC('month', $1::date)
            WHERE 1=1
        `;
        
        const params = [targetMonth];
        let paramIndex = 2;
        if (property_id) { 
            query += ` AND p.id = $${paramIndex++}`; 
            params.push(property_id); 
        }
        query += ` ORDER BY p.name, r.floor_number NULLS FIRST, r.house_no`;
        
        const result = await pool.query(query, params);
        
        const processedData = result.rows.map(row => {
            const rentPayable = parseFloat(row.rent_amount) || 0;
            const rentPaid = parseFloat(row.rent_paid) || 0;
            
            // Arrears: only if paid < payable
            let arrears = 0;
            let overpayment = 0;
            
            if (rentPaid < rentPayable) {
                arrears = rentPayable - rentPaid;
            } else if (rentPaid > rentPayable) {
                overpayment = rentPaid - rentPayable;
            }
            
            // Deposit balance: only if deposit was billed
            const depositRequired = parseFloat(row.deposit_required) || 0;
            const depositPaid = parseFloat(row.deposit_paid_total) || 0;
            const depositBalance = depositRequired - depositPaid;
            
            // Penalty: awarded - paid
            const penaltyAwarded = parseFloat(row.penalty_awarded) || 0;
            const penaltyPaid = parseFloat(row.penalty_paid_total) || 0;
            const penalty = penaltyAwarded - penaltyPaid;
            
            return {
                ...row,
                rent_payable: rentPayable,
                rent_paid: rentPaid,
                arrears: arrears > 0 ? arrears : 0,
                overpayment: overpayment > 0 ? overpayment : 0,
                deposit_balance: depositBalance > 0 ? depositBalance : 0,
                penalty: penalty,
                has_tenant: row.tenant_id !== null
            };
        });
        res.json(processedData);
    } catch (error) {
        console.error('GET /financials/tenant-list error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get filter data
router.get('/filters/data', auth, async (req, res) => {
    try {
        const properties = await pool.query('SELECT id, name, landlord_name FROM properties ORDER BY name');
        const months = [];
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({ year: date.getFullYear(), month: date.getMonth() + 1, display: date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) });
        }
        res.json({ properties: properties.rows, months: months });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;