const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const { blockViewerWrites, requireOwner } = require('../middleware/requireRole');

const router = express.Router();

router.use(auth, blockViewerWrites);

// ─── Helper: verify a tenant belongs to this owner ────────────────────────────
async function assertTenantOwnership(tenantId, ownerId) {
    const r = await pool.query(
        'SELECT id FROM tenants WHERE id = $1 AND owner_id = $2',
        [tenantId, ownerId]
    );
    return r.rows.length > 0;
}

// ─── Helper: verify a bill belongs to this owner ─────────────────────────────
async function assertBillOwnership(billId, ownerId) {
    const r = await pool.query(
        'SELECT id FROM bills WHERE id = $1 AND owner_id = $2',
        [billId, ownerId]
    );
    return r.rows.length > 0;
}

// ─── Helper: update bill status ──────────────────────────────────────────────
async function updateBillStatus(billId) {
    const result = await pool.query(
        'SELECT total_bill, total_paid FROM bills WHERE id = $1',
        [billId]
    );
    if (result.rows.length === 0) return;
    const { total_bill, total_paid } = result.rows[0];
    let status = 'not_paid';
    if (parseFloat(total_paid) >= parseFloat(total_bill)) status = 'paid';
    else if (parseFloat(total_paid) > 0)                  status = 'partially_paid';
    await pool.query(
        'UPDATE bills SET status = $1, updated_at = NOW() WHERE id = $2',
        [status, billId]
    );
}

// GET all bills — scoped to owner
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*,
                   t.first_name, t.last_name, t.phone,
                   p.name AS property_name,
                   r.house_no
            FROM bills b
            LEFT JOIN tenants t ON b.tenant_id = t.id
            LEFT JOIN properties p ON b.property_id = p.id
            LEFT JOIN rooms r ON b.room_id = r.id
            WHERE b.owner_id = $1
              AND (t.is_deleted = FALSE OR t.is_deleted IS NULL)
            ORDER BY b.bill_month DESC, b.id DESC
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET single bill — must belong to this owner
router.get('/:id', async (req, res) => {
    try {
        const billResult = await pool.query(`
            SELECT b.*,
                   t.first_name, t.last_name, t.phone,
                   p.name AS property_name,
                   r.house_no
            FROM bills b
            LEFT JOIN tenants t ON b.tenant_id = t.id
            LEFT JOIN properties p ON b.property_id = p.id
            LEFT JOIN rooms r ON b.room_id = r.id
            WHERE b.id = $1 AND b.owner_id = $2
        `, [req.params.id, req.ownerId]);

        if (billResult.rows.length === 0) return res.status(404).json({ error: 'Bill not found' });

        const itemsResult = await pool.query(
            'SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id',
            [req.params.id]
        );
        res.json({ ...billResult.rows[0], items: itemsResult.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST create bill
router.post('/', async (req, res) => {
    const { tenant_id, property_id, room_id, bill_month, items, previous_balance } = req.body;

    try {
        if (!(await assertTenantOwnership(tenant_id, req.ownerId))) {
            return res.status(403).json({ error: 'Tenant does not belong to your account' });
        }

        const billMonthDate = new Date(bill_month);
        let total_bill = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
        total_bill += parseFloat(previous_balance) || 0;

        const existingBill = await pool.query(
            'SELECT id, total_bill FROM bills WHERE tenant_id = $1 AND bill_month = $2 AND owner_id = $3',
            [tenant_id, billMonthDate, req.ownerId]
        );

        let billId;
        if (existingBill.rows.length > 0) {
            const newTotal = parseFloat(existingBill.rows[0].total_bill) + total_bill;
            await pool.query(
                'UPDATE bills SET total_bill = $1, updated_at = NOW() WHERE id = $2',
                [newTotal, existingBill.rows[0].id]
            );
            billId = existingBill.rows[0].id;
        } else {
            const result = await pool.query(
                `INSERT INTO bills
                    (tenant_id, property_id, room_id, bill_month, month_year, total_bill, previous_balance, status, owner_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'not_paid',$8) RETURNING *`,
                [tenant_id, property_id, room_id, billMonthDate,
                 billMonthDate.toISOString().slice(0, 7),
                 total_bill, previous_balance || 0, req.ownerId]
            );
            billId = result.rows[0].id;
        }

        for (const item of items) {
            if (item.item_name && item.amount > 0) {
                await pool.query(
                    'INSERT INTO bill_items (bill_id, item_name, amount) VALUES ($1,$2,$3)',
                    [billId, item.item_name, item.amount]
                );
            }
        }

        res.json({ success: true, billId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update bill — manager+ can edit
router.put('/:id', async (req, res) => {
    const { previous_balance, items } = req.body;

    try {
        if (!(await assertBillOwnership(req.params.id, req.ownerId))) {
            return res.status(404).json({ error: 'Bill not found' });
        }

        let total_bill = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
        total_bill += parseFloat(previous_balance) || 0;

        await pool.query(
            'UPDATE bills SET total_bill = $1, previous_balance = $2, updated_at = NOW() WHERE id = $3',
            [total_bill, previous_balance || 0, req.params.id]
        );
        await pool.query('DELETE FROM bill_items WHERE bill_id = $1', [req.params.id]);
        for (const item of items) {
            if (item.item_name && item.amount > 0) {
                await pool.query(
                    'INSERT INTO bill_items (bill_id, item_name, amount) VALUES ($1,$2,$3)',
                    [req.params.id, item.item_name, item.amount]
                );
            }
        }
        res.json({ message: 'Bill updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE bill — owner only
router.delete('/:id', requireOwner, async (req, res) => {
    try {
        const bill = await pool.query(
            'SELECT total_paid FROM bills WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (bill.rows.length === 0) return res.status(404).json({ error: 'Bill not found' });
        if (bill.rows[0].total_paid > 0) {
            return res.status(400).json({ error: 'Cannot delete bill with payments applied' });
        }
        await pool.query('DELETE FROM bills WHERE id = $1', [req.params.id]);
        res.json({ message: 'Bill deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST auto-generate bills — scoped to owner's tenants
router.post('/auto-generate', async (req, res) => {
    const { month, year } = req.body;
    const billMonth = new Date(year, month - 1, 1);

    try {
        const tenants = await pool.query(`
            SELECT t.id, t.property_id, t.room_id, r.rent
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.owner_id = $1 AND t.is_deleted = FALSE AND r.status = 'occupied'
        `, [req.ownerId]);

        let generated = 0, skipped = 0;

        for (const tenant of tenants.rows) {
            const existing = await pool.query(
                'SELECT id FROM bills WHERE tenant_id = $1 AND bill_month = $2 AND owner_id = $3',
                [tenant.id, billMonth, req.ownerId]
            );
            if (existing.rows.length > 0) { skipped++; continue; }

            const rentAmount = parseFloat(tenant.rent) || 0;
            const result = await pool.query(
                `INSERT INTO bills (tenant_id, property_id, room_id, bill_month, total_bill, status, owner_id)
                 VALUES ($1,$2,$3,$4,$5,'not_paid',$6) RETURNING id`,
                [tenant.id, tenant.property_id, tenant.room_id, billMonth, rentAmount, req.ownerId]
            );
            await pool.query(
                'INSERT INTO bill_items (bill_id, item_name, amount) VALUES ($1,$2,$3)',
                [result.rows[0].id, 'Rent', rentAmount]
            );
            generated++;
        }

        res.json({ message: `Rent bills generated: ${generated}, Skipped: ${skipped}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST bulk bills for a property
router.post('/bulk-property', async (req, res) => {
    const { property_id, bill_month, item_name, amount } = req.body;

    try {
        // Verify property ownership
        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [property_id, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        const billMonthDate = new Date(bill_month);
        const tenants = await pool.query(`
            SELECT t.id, t.room_id FROM tenants t
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.property_id = $1 AND t.owner_id = $2
              AND t.is_deleted = FALSE AND r.status = 'occupied'
        `, [property_id, req.ownerId]);

        let created = 0, updated = 0;
        for (const tenant of tenants.rows) {
            const existingBill = await pool.query(
                'SELECT id, total_bill FROM bills WHERE tenant_id = $1 AND bill_month = $2 AND owner_id = $3',
                [tenant.id, billMonthDate, req.ownerId]
            );
            if (existingBill.rows.length > 0) {
                await pool.query(
                    'UPDATE bills SET total_bill = $1, updated_at = NOW() WHERE id = $2',
                    [parseFloat(existingBill.rows[0].total_bill) + amount, existingBill.rows[0].id]
                );
                updated++;
            } else {
                await pool.query(
                    `INSERT INTO bills (tenant_id, property_id, room_id, bill_month, total_bill, status, owner_id)
                     VALUES ($1,$2,$3,$4,$5,'not_paid',$6)`,
                    [tenant.id, property_id, tenant.room_id, billMonthDate, amount, req.ownerId]
                );
                created++;
            }
        }
        res.json({ message: `Bills created: ${created}, Updated: ${updated}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST award penalties — scoped to owner
router.post('/award-penalties', async (req, res) => {
    const { month, year } = req.body;
    const previousMonth = new Date(year, month - 2, 1);

    try {
        const tenantsWithArrears = await pool.query(`
            SELECT DISTINCT t.id, t.first_name, t.last_name, t.phone,
                   b.id AS bill_id, b.total_bill, b.total_paid,
                   p.penalty_amount, r.house_no
            FROM tenants t
            JOIN bills b ON t.id = b.tenant_id
            JOIN properties p ON t.property_id = p.id
            JOIN rooms r ON t.room_id = r.id
            WHERE b.bill_month = $1 AND b.total_bill > b.total_paid
              AND t.is_deleted = FALSE AND t.owner_id = $2
        `, [previousMonth, req.ownerId]);

        let awarded = 0;
        for (const tenant of tenantsWithArrears.rows) {
            const penaltyAmount = parseFloat(tenant.penalty_amount) || 500;
            const existing = await pool.query(
                'SELECT id FROM penalty_log WHERE tenant_id = $1 AND month_year = $2',
                [tenant.id, previousMonth]
            );
            if (existing.rows.length > 0) continue;

            await pool.query(
                'UPDATE bills SET total_bill = total_bill + $1, penalty_amount = COALESCE(penalty_amount,0) + $1 WHERE id = $2',
                [penaltyAmount, tenant.bill_id]
            );
            await pool.query(
                `INSERT INTO penalty_log (tenant_id, bill_id, amount, awarded_date, month_year, message_sent, owner_id)
                 VALUES ($1,$2,$3,$4,$5,FALSE,$6)`,
                [tenant.id, tenant.bill_id, penaltyAmount, new Date(), previousMonth, req.ownerId]
            );
            awarded++;
        }
        res.json({ message: `Penalties awarded: ${awarded}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET tenant balance breakdown — ownership enforced
router.get('/tenant-breakdown/:tenantId', async (req, res) => {
    try {
        if (!(await assertTenantOwnership(req.params.tenantId, req.ownerId))) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        const result = await pool.query(`
            SELECT bi.item_name, SUM(bi.amount) AS amount
            FROM bills b
            JOIN bill_items bi ON b.id = bi.bill_id
            WHERE b.tenant_id = $1 AND b.total_bill > b.total_paid AND b.owner_id = $2
            GROUP BY bi.item_name
        `, [req.params.tenantId, req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET tenant invoices
router.get('/tenant-invoices/:tenantId', async (req, res) => {
    try {
        if (!(await assertTenantOwnership(req.params.tenantId, req.ownerId))) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        const result = await pool.query(`
            SELECT b.*,
                   (SELECT json_agg(json_build_object('item_name', bi.item_name, 'amount', bi.amount))
                    FROM bill_items bi WHERE bi.bill_id = b.id) AS items
            FROM bills b
            WHERE b.tenant_id = $1 AND b.owner_id = $2
            ORDER BY b.bill_month DESC
        `, [req.params.tenantId, req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET tenant balance
router.get('/tenant-balance/:tenantId', async (req, res) => {
    try {
        if (!(await assertTenantOwnership(req.params.tenantId, req.ownerId))) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        const result = await pool.query(
            'SELECT COALESCE(SUM(total_bill - total_paid), 0) AS balance FROM bills WHERE tenant_id = $1 AND owner_id = $2',
            [req.params.tenantId, req.ownerId]
        );
        res.json({ balance: parseFloat(result.rows[0].balance) || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
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
        const rooms = await pool.query(`
            SELECT r.id, r.house_no, r.property_id FROM rooms r
            JOIN properties p ON r.property_id = p.id
            WHERE p.owner_id = $1 ORDER BY r.house_no
        `, [req.ownerId]);
        res.json({ properties: properties.rows, tenants: tenants.rows, rooms: rooms.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
