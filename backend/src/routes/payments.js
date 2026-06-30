const express = require('express');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { blockViewerWrites, requireOwner } = require('../middleware/requireRole');

const router = express.Router();

router.use(auth, blockViewerWrites);

// ─── Helper: clean and parse amount string ────────────────────────────────────
function parseAmount(raw) {
    if (typeof raw === 'string') {
        raw = raw.replace(/,/g, '').replace(/[^0-9.]/g, '');
        const parts = raw.split('.');
        if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');
    }
    return parseFloat(raw);
}

// ─── Helper: apply payment to oldest unpaid bills ────────────────────────────
async function applyPaymentToBills(tenantId, amount, ownerId) {
    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const billsResult = await client.query(
            `SELECT id, total_bill, total_paid FROM bills
             WHERE tenant_id = $1 AND owner_id = $2 AND total_bill > total_paid
             ORDER BY bill_month ASC`,
            [tenantId, ownerId]
        );

        let remaining = paymentAmount;
        for (const bill of billsResult.rows) {
            if (remaining <= 0) break;
            const owed = parseFloat(bill.total_bill) - parseFloat(bill.total_paid);
            const apply = Math.min(remaining, owed);
            if (apply > 0) {
                const newPaid = parseFloat(bill.total_paid) + apply;
                const newStatus = newPaid >= parseFloat(bill.total_bill)
                    ? 'paid' : newPaid > 0 ? 'partially_paid' : 'not_paid';
                await client.query(
                    'UPDATE bills SET total_paid = $1, status = $2, updated_at = NOW() WHERE id = $3',
                    [newPaid, newStatus, bill.id]
                );
                remaining -= apply;
            }
        }
        await updateTenantBalance(tenantId, client);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ─── Helper: recalculate tenant balance ──────────────────────────────────────
async function updateTenantBalance(tenantId, client) {
    const db = client || pool;
    const result = await db.query(
        'SELECT COALESCE(SUM(total_bill - total_paid), 0) AS balance FROM bills WHERE tenant_id = $1',
        [tenantId]
    );
    await db.query(
        'UPDATE tenants SET balance = $1 WHERE id = $2',
        [parseFloat(result.rows[0].balance) || 0, tenantId]
    );
}

// ─── Helper: verify payment belongs to this owner ────────────────────────────
async function assertPaymentOwnership(paymentId, ownerId) {
    const r = await pool.query(
        'SELECT id, tenant_id FROM payments WHERE id = $1 AND owner_id = $2',
        [paymentId, ownerId]
    );
    return r.rows[0] || null;
}

// GET all payments — scoped to owner
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                   t.first_name, t.last_name, t.phone,
                   r.house_no,
                   pr.name AS property_name
            FROM payments p
            LEFT JOIN tenants t  ON p.tenant_id = t.id
            LEFT JOIN rooms r    ON t.room_id = r.id
            LEFT JOIN properties pr ON t.property_id = pr.id
            WHERE p.owner_id = $1
            ORDER BY p.payment_date DESC, p.id DESC
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// GET single payment — ownership enforced
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                   t.first_name, t.last_name, t.phone,
                   r.house_no, pr.name AS property_name
            FROM payments p
            LEFT JOIN tenants t  ON p.tenant_id = t.id
            LEFT JOIN rooms r    ON t.room_id = r.id
            LEFT JOIN properties pr ON t.property_id = pr.id
            WHERE p.id = $1 AND p.owner_id = $2
        `, [req.params.id, req.ownerId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// GET payments by tenant — ownership enforced
router.get('/tenant/:tenantId', async (req, res) => {
    try {
        const tenantCheck = await pool.query(
            'SELECT id FROM tenants WHERE id = $1 AND owner_id = $2',
            [req.params.tenantId, req.ownerId]
        );
        if (tenantCheck.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        const result = await pool.query(
            'SELECT * FROM payments WHERE tenant_id = $1 AND owner_id = $2 ORDER BY payment_date DESC',
            [req.params.tenantId, req.ownerId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// POST create payment — manager+
router.post('/', async (req, res) => {
    const { tenant_id, amount, payment_date, payment_type, transaction_id, notes, password } = req.body;

    try {
        // Verify admin password
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        if (!admin.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
        const valid = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid password' });

        // Verify tenant belongs to this owner
        const tenantCheck = await pool.query(
            'SELECT id FROM tenants WHERE id = $1 AND owner_id = $2',
            [tenant_id, req.ownerId]
        );
        if (tenantCheck.rows.length === 0) return res.status(403).json({ error: 'Tenant not found' });

        // Check duplicate transaction
        if (transaction_id) {
            const dup = await pool.query(
                'SELECT id FROM payments WHERE transaction_id = $1',
                [transaction_id]
            );
            if (dup.rows.length > 0) return res.status(400).json({ error: 'Transaction ID already exists' });
        }

        const numericAmount = parseAmount(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount: ' + amount });
        }

        const result = await pool.query(
            `INSERT INTO payments
                (tenant_id, amount, payment_date, payment_type, transaction_id, notes, source, owner_id)
             VALUES ($1,$2,$3,$4,$5,$6,'manual',$7) RETURNING *`,
            [tenant_id, numericAmount, payment_date || new Date(),
             payment_type || 'rent', transaction_id, notes, req.ownerId]
        );

        await applyPaymentToBills(tenant_id, numericAmount, req.ownerId);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// PUT update payment — manager+ (only deposit/penalty types)
router.put('/:id', async (req, res) => {
    const { amount, payment_date, payment_type, transaction_id, notes, password, edit_reason } = req.body;

    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const valid = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid password' });

        const payment = await assertPaymentOwnership(req.params.id, req.ownerId);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });

        const current = await pool.query(
            'SELECT payment_type, tenant_id FROM payments WHERE id = $1',
            [req.params.id]
        );
        if (current.rows[0].payment_type === 'rent') {
            return res.status(403).json({ error: 'Rent payments cannot be edited' });
        }

        const numericAmount = parseAmount(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const result = await pool.query(
            `UPDATE payments
             SET amount = $1, payment_date = $2, payment_type = $3, transaction_id = $4,
                 notes = $5, edited_by = $6, edit_reason = $7, edit_count = edit_count + 1
             WHERE id = $8 AND owner_id = $9 RETURNING *`,
            [numericAmount, payment_date, payment_type, transaction_id, notes,
             req.adminId, edit_reason, req.params.id, req.ownerId]
        );

        await updateTenantBalance(current.rows[0].tenant_id);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE payment — owner only
router.delete('/:id', requireOwner, async (req, res) => {
    const { password } = req.body;

    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const valid = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid password' });

        const payment = await assertPaymentOwnership(req.params.id, req.ownerId);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });

        await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]);
        await updateTenantBalance(payment.tenant_id);
        res.json({ message: 'Payment deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// GET summary stats — scoped to owner
router.get('/summary/stats', async (req, res) => {
    try {
        const { start_date, end_date, property_id, source } = req.query;
        let query = `
            SELECT
                COALESCE(SUM(p.amount), 0) AS total,
                COALESCE(SUM(CASE WHEN p.source = 'manual' THEN p.amount ELSE 0 END), 0) AS manual_total,
                COALESCE(SUM(CASE WHEN p.source = 'auto'   THEN p.amount ELSE 0 END), 0) AS auto_total
            FROM payments p
            LEFT JOIN tenants t ON p.tenant_id = t.id
            WHERE p.owner_id = $1
        `;
        const params = [req.ownerId];
        let i = 2;

        if (start_date)                 { query += ` AND p.payment_date >= $${i++}`; params.push(start_date); }
        if (end_date)                   { query += ` AND p.payment_date <= $${i++}`; params.push(end_date); }
        if (property_id)                { query += ` AND t.property_id = $${i++}`;   params.push(property_id); }
        if (source && source !== 'all') { query += ` AND p.source = $${i++}`;        params.push(source); }

        const result = await pool.query(query, params);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// GET filter data — scoped to owner
router.get('/filters/data', async (req, res) => {
    try {
        const properties = await pool.query(
            'SELECT id, name FROM properties WHERE owner_id = $1 ORDER BY name',
            [req.ownerId]
        );
        const tenants = await pool.query(
            'SELECT id, first_name, last_name FROM tenants WHERE owner_id = $1 AND is_deleted = FALSE ORDER BY first_name',
            [req.ownerId]
        );
        res.json({ properties: properties.rows, tenants: tenants.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
