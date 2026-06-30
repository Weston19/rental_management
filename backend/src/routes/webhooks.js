const express = require('express');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const { blockViewerWrites } = require('../middleware/requireRole');

const router = express.Router();

// ─── Helper: apply payment to unpaid bills ────────────────────────────────────
async function applyPaymentToBills(tenantId, amount) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const bills = await client.query(
            `SELECT id, total_bill, total_paid FROM bills
             WHERE tenant_id = $1 AND total_bill > total_paid ORDER BY bill_month ASC`,
            [tenantId]
        );
        let remaining = parseFloat(amount);
        for (const bill of bills.rows) {
            if (remaining <= 0) break;
            const owed  = parseFloat(bill.total_bill) - parseFloat(bill.total_paid);
            const apply = Math.min(remaining, owed);
            if (apply > 0) {
                const newPaid  = parseFloat(bill.total_paid) + apply;
                const newStatus = newPaid >= parseFloat(bill.total_bill) ? 'paid'
                                : newPaid > 0 ? 'partially_paid' : 'not_paid';
                await client.query(
                    'UPDATE bills SET total_paid = $1, status = $2, updated_at = NOW() WHERE id = $3',
                    [newPaid, newStatus, bill.id]
                );
                remaining -= apply;
            }
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ─── Helper: process an incoming M-Pesa payment ───────────────────────────────
// Webhooks arrive unauthenticated (from M-Pesa). Tenant lookup is done by
// account_number which maps to a house_no. owner_id is inferred from the tenant.
async function processMpesaPayment(data) {
    const { account_number, amount, transaction_id, phone_number, payment_date } = data;

    try {
        const existing = await pool.query(
            'SELECT id FROM payments WHERE transaction_id = $1',
            [transaction_id]
        );
        if (existing.rows.length > 0) return { success: true, message: 'Duplicate transaction ignored' };

        let payment_type = 'rent';
        let room_no      = account_number;
        let isCombined   = false;

        if (account_number.startsWith('RD'))     { payment_type = 'combined'; room_no = account_number.substring(2); isCombined = true; }
        else if (account_number.startsWith('D')) { payment_type = 'deposit';  room_no = account_number.substring(1); }
        else if (account_number.startsWith('P')) { payment_type = 'penalty';  room_no = account_number.substring(1); }

        const tenant = await pool.query(`
            SELECT t.*, r.deposit, r.rent
            FROM tenants t
            JOIN rooms r ON t.room_id = r.id
            WHERE r.house_no = $1 AND t.is_deleted = FALSE
        `, [room_no]);

        if (tenant.rows.length === 0) {
            await pool.query(
                `INSERT INTO unassigned_payments
                    (account_number, amount, transaction_id, phone_number, payment_date)
                 VALUES ($1,$2,$3,$4,$5)`,
                [account_number, amount, transaction_id, phone_number, payment_date || new Date()]
            );
            return { success: false, message: 'Account number not recognized' };
        }

        const { id: tenantId, owner_id, deposit: depositAmount } = tenant.rows[0];

        if (isCombined) {
            let rem = parseFloat(amount);
            const dep = parseFloat(depositAmount) || 0;
            if (dep > 0) {
                const depPaid = Math.min(rem, dep);
                rem -= depPaid;
                await pool.query(
                    `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source, owner_id)
                     VALUES ($1,$2,$3,'deposit',$4,'auto',$5)`,
                    [tenantId, depPaid, payment_date || new Date(), transaction_id + '_deposit', owner_id]
                );
            }
            if (rem > 0) {
                await pool.query(
                    `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source, owner_id)
                     VALUES ($1,$2,$3,'rent',$4,'auto',$5)`,
                    [tenantId, rem, payment_date || new Date(), transaction_id + '_rent', owner_id]
                );
            }
        } else {
            await pool.query(
                `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source, owner_id)
                 VALUES ($1,$2,$3,$4,$5,'auto',$6)`,
                [tenantId, amount, payment_date || new Date(), payment_type, transaction_id, owner_id]
            );
        }

        await applyPaymentToBills(tenantId, amount);
        return { success: true, message: 'Payment recorded' };
    } catch (error) {
        console.error('Process payment error:', error);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// M-PESA WEBHOOK  (no auth — called by M-Pesa servers)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/mpesa/payment', async (req, res) => {
    const { account_number, amount, transaction_id } = req.body;
    if (!account_number || !amount || !transaction_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await processMpesaPayment(req.body);
    if (!result.success) {
        return res.status(202).json({ message: 'Payment queued for processing' });
    }
    res.json({ success: true, message: result.message });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNASSIGNED PAYMENTS — auth required, scoped to owner
// ─────────────────────────────────────────────────────────────────────────────
router.get('/unassigned', auth, async (req, res) => {
    try {
        // owner_id may be null for very old records; show only this owner's or NULL
        const result = await pool.query(`
            SELECT * FROM unassigned_payments
            WHERE assigned_to_tenant_id IS NULL
              AND (owner_id = $1 OR owner_id IS NULL)
            ORDER BY created_at DESC
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST assign unassigned payment — manager+, scoped to owner
router.post('/unassigned/assign/:id', auth, blockViewerWrites, async (req, res) => {
    const { room_id } = req.body;

    try {
        // Verify room belongs to this owner
        const room = await pool.query(`
            SELECT t.id AS tenant_id, t.owner_id
            FROM rooms r
            JOIN properties p  ON r.property_id = p.id
            JOIN tenants t     ON r.id = t.room_id
            WHERE r.id = $1 AND p.owner_id = $2 AND t.is_deleted = FALSE
        `, [room_id, req.ownerId]);

        if (room.rows.length === 0) return res.status(404).json({ error: 'No active tenant found in this room' });

        const payment = await pool.query(
            'SELECT * FROM unassigned_payments WHERE id = $1',
            [req.params.id]
        );
        if (payment.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

        const tenantId = room.rows[0].tenant_id;
        const ownerId  = room.rows[0].owner_id;

        await pool.query(
            `INSERT INTO payments (tenant_id, amount, payment_date, payment_type, transaction_id, source, owner_id)
             VALUES ($1,$2,$3,'rent',$4,'auto',$5)`,
            [tenantId, payment.rows[0].amount, payment.rows[0].payment_date,
             payment.rows[0].transaction_id, ownerId]
        );
        await pool.query(
            `UPDATE unassigned_payments
             SET assigned_to_tenant_id = $1, assigned_at = NOW(), owner_id = $2
             WHERE id = $3`,
            [tenantId, ownerId, req.params.id]
        );
        await applyPaymentToBills(tenantId, payment.rows[0].amount);
        res.json({ message: 'Payment assigned successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
