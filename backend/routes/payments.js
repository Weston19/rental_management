const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcrypt');

const router = express.Router();

// Get all payments
router.get('/', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, 
                   t.first_name, t.last_name, t.phone,
                   r.house_no,
                   pr.name as property_name
            FROM payments p
            LEFT JOIN tenants t ON p.tenant_id = t.id
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN properties pr ON t.property_id = pr.id
            ORDER BY p.payment_date DESC, p.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('GET /payments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single payment
router.get('/:id', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, t.first_name, t.last_name, t.phone,
                   r.house_no, pr.name as property_name
            FROM payments p
            LEFT JOIN tenants t ON p.tenant_id = t.id
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN properties pr ON t.property_id = pr.id
            WHERE p.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error('GET /payments/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get payments by tenant
router.get('/tenant/:tenantId', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM payments WHERE tenant_id = $1 ORDER BY payment_date DESC
        `, [req.params.tenantId]);
        res.json(result.rows);
    } catch (error) {
        console.error('GET /payments/tenant/:tenantId error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== CREATE PAYMENT ==========
router.post('/', auth, async (req, res) => {
    const { tenant_id, amount, payment_date, payment_type, transaction_id, notes, password } = req.body;
    
    console.log('📡 Creating payment:', { tenant_id, amount, payment_date, payment_type });
    
    try {
        // Verify admin password
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        // Check for duplicate transaction
        if (transaction_id) {
            const existing = await pool.query('SELECT id FROM payments WHERE transaction_id = $1', [transaction_id]);
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'Transaction ID already exists' });
            }
        }
        
        // Clean and parse the amount
        let cleanAmount = amount;
        if (typeof cleanAmount === 'string') {
            // Remove commas and non-numeric characters except decimal point
            cleanAmount = cleanAmount.replace(/,/g, '').replace(/[^0-9.]/g, '');
            // If there are multiple decimal points, keep only the first one
            const parts = cleanAmount.split('.');
            if (parts.length > 2) {
                cleanAmount = parts[0] + '.' + parts.slice(1).join('');
            }
        }
        const numericAmount = parseFloat(cleanAmount);
        
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount: ' + amount });
        }
        
        console.log('✅ Cleaned amount:', numericAmount);
        
        // Insert payment
        const result = await pool.query(
            `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, notes, source)
             VALUES ($1, $2, $3, $4, $5, $6, 'manual') RETURNING *`,
            [tenant_id, numericAmount, payment_date || new Date(), payment_type || 'rent', transaction_id, notes]
        );
        
        const payment = result.rows[0];
        console.log('✅ Payment recorded:', payment.id);
        
        // Apply payment to bills
        console.log('🔄 Calling applyPaymentToBills for tenant:', tenant_id, 'Amount:', numericAmount);
        await applyPaymentToBills(tenant_id, numericAmount);
        console.log('✅ applyPaymentToBills completed for tenant:', tenant_id);
        
        res.json(payment);
    } catch (error) {
        console.error('POST /payments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== UPDATE PAYMENT ==========
router.put('/:id', auth, async (req, res) => {
    const { amount, payment_date, payment_type, transaction_id, notes, password, edit_reason } = req.body;
    
    try {
        // Verify admin password
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        
        const currentPayment = await pool.query('SELECT payment_type, tenant_id, amount FROM payments WHERE id = $1', [req.params.id]);
        if (currentPayment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        
        // Only deposit and penalty can be edited
        if (currentPayment.rows[0].payment_type === 'rent') {
            return res.status(403).json({ error: 'Rent payments cannot be edited' });
        }
        
        // Clean amount
        let cleanAmount = amount;
        if (typeof cleanAmount === 'string') {
            cleanAmount = cleanAmount.replace(/,/g, '').replace(/[^0-9.]/g, '');
            const parts = cleanAmount.split('.');
            if (parts.length > 2) {
                cleanAmount = parts[0] + '.' + parts.slice(1).join('');
            }
        }
        const numericAmount = parseFloat(cleanAmount);
        
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        
        const result = await pool.query(
            `UPDATE payments SET amount = $1, payment_date = $2, payment_type = $3, transaction_id = $4, notes = $5,
             edited_by = $6, edit_reason = $7, edit_count = edit_count + 1 WHERE id = $8 RETURNING *`,
            [numericAmount, payment_date, payment_type, transaction_id, notes, req.adminId, edit_reason, req.params.id]
        );
        
        // Recalculate balance
        await updateTenantBalance(currentPayment.rows[0].tenant_id);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('PUT /payments/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== DELETE PAYMENT ==========
router.delete('/:id', auth, async (req, res) => {
    const { password } = req.body;
    
    try {
        // Verify admin password
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid password' });
        
        const payment = await pool.query('SELECT tenant_id, amount FROM payments WHERE id = $1', [req.params.id]);
        if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        
        await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]);
        await updateTenantBalance(payment.rows[0].tenant_id);
        res.json({ message: 'Payment deleted successfully' });
    } catch (error) {
        console.error('DELETE /payments/:id error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== SUMMARY STATS ==========
router.get('/summary/stats', auth, async (req, res) => {
    try {
        const { start_date, end_date, property_id, source } = req.query;
        
        let query = `
            SELECT 
                COALESCE(SUM(p.amount), 0) as total,
                COALESCE(SUM(CASE WHEN p.source = 'manual' THEN p.amount ELSE 0 END), 0) as manual_total,
                COALESCE(SUM(CASE WHEN p.source = 'auto' THEN p.amount ELSE 0 END), 0) as auto_total
            FROM payments p
            LEFT JOIN tenants t ON p.tenant_id = t.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        if (start_date) { query += ` AND p.payment_date >= $${paramIndex++}`; params.push(start_date); }
        if (end_date) { query += ` AND p.payment_date <= $${paramIndex++}`; params.push(end_date); }
        if (property_id) { query += ` AND t.property_id = $${paramIndex++}`; params.push(property_id); }
        if (source && source !== 'all') { query += ` AND p.source = $${paramIndex++}`; params.push(source); }
        
        const result = await pool.query(query, params);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('GET /payments/summary/stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== FILTER DATA ==========
router.get('/filters/data', auth, async (req, res) => {
    try {
        const properties = await pool.query('SELECT id, name FROM properties ORDER BY name');
        const tenants = await pool.query('SELECT id, first_name, last_name FROM tenants WHERE is_deleted = FALSE ORDER BY first_name');
        res.json({ properties: properties.rows, tenants: tenants.rows });
    } catch (error) {
        console.error('GET /payments/filters/data error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== HELPER FUNCTIONS ==========

// Apply payment to bills
async function applyPaymentToBills(tenantId, amount) {
    console.log('🔄 Applying payment to bills for tenant:', tenantId, 'Amount:', amount);
    
    // Ensure amount is a valid number
    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
        console.log('❌ Invalid payment amount:', amount);
        return;
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get all unpaid bills for this tenant, ordered oldest first
        const billsResult = await client.query(
            `SELECT id, total_bill, total_paid, status 
             FROM bills 
             WHERE tenant_id = $1 AND total_bill > total_paid
             ORDER BY bill_month ASC`,
            [tenantId]
        );
        
        console.log(`Found ${billsResult.rows.length} unpaid bills for tenant ${tenantId}`);
        
        let remainingAmount = paymentAmount;
        
        for (const bill of billsResult.rows) {
            if (remainingAmount <= 0) break;
            
            const billOwed = parseFloat(bill.total_bill) - parseFloat(bill.total_paid);
            const paymentToApply = Math.min(remainingAmount, billOwed);
            
            if (paymentToApply > 0) {
                const newTotalPaid = parseFloat(bill.total_paid) + paymentToApply;
                let newStatus = 'not_paid';
                
                if (newTotalPaid >= parseFloat(bill.total_bill)) {
                    newStatus = 'paid';
                } else if (newTotalPaid > 0) {
                    newStatus = 'partially_paid';
                }
                
                // UPDATE THE BILL
                const updateResult = await client.query(
                    `UPDATE bills 
                     SET total_paid = $1, status = $2, updated_at = NOW()
                     WHERE id = $3
                     RETURNING *`,
                    [newTotalPaid, newStatus, bill.id]
                );
                
                console.log(`✅ Bill ${bill.id} updated: total_paid = ${newTotalPaid}, Status: ${newStatus}`);
                remainingAmount -= paymentToApply;
            }
        }
        
        // Update tenant balance
        await updateTenantBalance(tenantId);
        
        await client.query('COMMIT');
        console.log('✅ Payment application completed successfully');
        
        if (remainingAmount > 0) {
            console.log(`⚠️ Overpayment of KES ${remainingAmount} will be stored as credit`);
        }
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error applying payment:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Update tenant balance
async function updateTenantBalance(tenantId) {
    const result = await pool.query(
        `SELECT COALESCE(SUM(total_bill - total_paid), 0) as balance
         FROM bills 
         WHERE tenant_id = $1`,
        [tenantId]
    );
    
    const newBalance = parseFloat(result.rows[0].balance) || 0;
    
    await pool.query(
        `UPDATE tenants SET balance = $1 WHERE id = $2`,
        [newBalance, tenantId]
    );
    
    console.log(`✅ Tenant ${tenantId} balance updated to: ${newBalance}`);
    return newBalance;
}

module.exports = router;