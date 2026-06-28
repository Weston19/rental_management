const express = require('express');
const pool = require('../db');
const bcrypt = require('bcrypt');

const router = express.Router();
let webhookQueue = [];

// Helper: Apply payment to bills
async function applyPaymentToBills(tenantId, amount) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const bills = await client.query(
            `SELECT id, total_bill, total_paid FROM bills 
             WHERE tenant_id = $1 AND total_bill > total_paid ORDER BY bill_month ASC`,
            [tenantId]
        );
        let remainingAmount = amount;
        for (const bill of bills.rows) {
            if (remainingAmount <= 0) break;
            const billOwed = bill.total_bill - bill.total_paid;
            const paymentToApply = Math.min(remainingAmount, billOwed);
            if (paymentToApply > 0) {
                const newTotalPaid = bill.total_paid + paymentToApply;
                let newStatus = 'not_paid';
                if (newTotalPaid >= bill.total_bill) newStatus = 'paid';
                else if (newTotalPaid > 0) newStatus = 'partially_paid';
                await client.query('UPDATE bills SET total_paid = $1, status = $2 WHERE id = $3', [newTotalPaid, newStatus, bill.id]);
                remainingAmount -= paymentToApply;
            }
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Process M-Pesa payment
async function processMpesaPayment(data) {
    const { account_number, amount, transaction_id, phone_number, payment_date } = data;
    
    try {
        const existing = await pool.query('SELECT id FROM payments WHERE transaction_id = $1', [transaction_id]);
        if (existing.rows.length > 0) return { success: true, message: 'Duplicate transaction ignored' };
        
        let payment_type = 'rent';
        let room_no = account_number;
        let isCombined = false;
        
        if (account_number.startsWith('RD')) {
            payment_type = 'combined';
            room_no = account_number.substring(2);
            isCombined = true;
        } else if (account_number.startsWith('D')) {
            payment_type = 'deposit';
            room_no = account_number.substring(1);
        } else if (account_number.startsWith('P')) {
            payment_type = 'penalty';
            room_no = account_number.substring(1);
        }
        
        const tenant = await pool.query(`
            SELECT t.*, r.deposit, r.rent FROM tenants t 
            JOIN rooms r ON t.room_id = r.id 
            WHERE r.house_no = $1 AND t.is_deleted = FALSE
        `, [room_no]);
        
        if (tenant.rows.length === 0) {
            await pool.query(
                `INSERT INTO unassigned_payments (account_number, amount, transaction_id, phone_number, payment_date)
                 VALUES ($1, $2, $3, $4, $5)`,
                [account_number, amount, transaction_id, phone_number, payment_date || new Date()]
            );
            return { success: false, message: 'Account number not recognized' };
        }
        
        const tenantId = tenant.rows[0].id;
        const depositAmount = parseFloat(tenant.rows[0].deposit) || 0;
        
        if (isCombined) {
            let remainingAmount = amount;
            if (depositAmount > 0) {
                const depositPaid = Math.min(remainingAmount, depositAmount);
                remainingAmount -= depositPaid;
                await pool.query(
                    `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source)
                     VALUES ($1, $2, $3, 'deposit', $4, 'auto')`,
                    [tenantId, depositPaid, payment_date || new Date(), transaction_id + '_deposit']
                );
            }
            if (remainingAmount > 0) {
                await pool.query(
                    `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source)
                     VALUES ($1, $2, $3, 'rent', $4, 'auto')`,
                    [tenantId, remainingAmount, payment_date || new Date(), transaction_id + '_rent']
                );
            }
        } else {
            await pool.query(
                `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source)
                 VALUES ($1, $2, $3, $4, $5, 'auto')`,
                [tenantId, amount, payment_date || new Date(), payment_type, transaction_id]
            );
        }
        
        await applyPaymentToBills(tenantId, amount);
        return { success: true, message: 'Payment recorded' };
    } catch (error) {
        console.error('Process payment error:', error);
        return { success: false, error: error.message };
    }
}

// M-Pesa webhook
router.post('/mpesa/payment', async (req, res) => {
    console.log('Webhook received:', req.body);
    const { account_number, amount, transaction_id, phone_number, payment_date } = req.body;
    if (!account_number || !amount || !transaction_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await processMpesaPayment(req.body);
    if (!result.success) {
        webhookQueue.push({ payload: req.body, attempts: 0 });
        return res.status(202).json({ message: 'Payment queued for processing' });
    }
    res.json({ success: true, message: result.message });
});

// Get unassigned payments
router.get('/unassigned', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM unassigned_payments WHERE assigned_to_tenant_id IS NULL ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Assign unassigned payment
router.post('/unassigned/assign/:id', async (req, res) => {
    const { room_id, password } = req.body;
    const paymentId = req.params.id;
    
    try {
        const room = await pool.query(`
            SELECT t.id as tenant_id FROM rooms r
            JOIN tenants t ON r.id = t.room_id
            WHERE r.id = $1 AND t.is_deleted = FALSE
        `, [room_id]);
        if (room.rows.length === 0) return res.status(404).json({ error: 'No active tenant found' });
        
        const payment = await pool.query('SELECT * FROM unassigned_payments WHERE id = $1', [paymentId]);
        if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        
        await pool.query(
            `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source)
             VALUES ($1, $2, $3, 'rent', $4, 'auto')`,
            [room.rows[0].tenant_id, payment.rows[0].amount, payment.rows[0].payment_date, payment.rows[0].transaction_id]
        );
        await pool.query(
            `UPDATE unassigned_payments SET assigned_to_tenant_id = $1, assigned_at = NOW() WHERE id = $2`,
            [room.rows[0].tenant_id, paymentId]
        );
        await applyPaymentToBills(room.rows[0].tenant_id, payment.rows[0].amount);
        res.json({ message: 'Payment assigned successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;