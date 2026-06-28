const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all bills
router.get('/', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, 
                   t.first_name, t.last_name, t.phone,
                   p.name as property_name,
                   r.house_no
            FROM bills b
            LEFT JOIN tenants t ON b.tenant_id = t.id
            LEFT JOIN properties p ON b.property_id = p.id
            LEFT JOIN rooms r ON b.room_id = r.id
            WHERE t.is_deleted = FALSE OR t.is_deleted IS NULL
            ORDER BY b.bill_month DESC, b.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single bill
router.get('/:id', auth, async (req, res) => {
    try {
        const billResult = await pool.query(`
            SELECT b.*, 
                   t.first_name, t.last_name, t.phone,
                   p.name as property_name,
                   r.house_no
            FROM bills b
            LEFT JOIN tenants t ON b.tenant_id = t.id
            LEFT JOIN properties p ON b.property_id = p.id
            LEFT JOIN rooms r ON b.room_id = r.id
            WHERE b.id = $1
        `, [req.params.id]);
        
        if (billResult.rows.length === 0) {
            return res.status(404).json({ error: 'Bill not found' });
        }
        
        const itemsResult = await pool.query(
            'SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id',
            [req.params.id]
        );
        
        res.json({
            ...billResult.rows[0],
            items: itemsResult.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create bill
router.post('/', auth, async (req, res) => {
    const { tenant_id, property_id, room_id, bill_month, items, previous_balance } = req.body;
    
    try {
        const billMonthDate = new Date(bill_month);
        const monthYear = billMonthDate.toISOString().slice(0, 7);
        
        let total_bill = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
        total_bill += parseFloat(previous_balance) || 0;
        
        const existingBill = await pool.query(
            'SELECT id, total_bill FROM bills WHERE tenant_id = $1 AND bill_month = $2',
            [tenant_id, billMonthDate]
        );
        
        let billId;
        
        if (existingBill.rows.length > 0) {
            const newTotal = parseFloat(existingBill.rows[0].total_bill) + total_bill;
            await pool.query(
                `UPDATE bills SET total_bill = $1, updated_at = NOW() WHERE id = $2`,
                [newTotal, existingBill.rows[0].id]
            );
            billId = existingBill.rows[0].id;
            
            for (const item of items) {
                if (item.item_name && item.amount > 0) {
                    await pool.query(
                        'INSERT INTO bill_items (bill_id, item_name, amount) VALUES ($1, $2, $3)',
                        [billId, item.item_name, item.amount]
                    );
                }
            }
        } else {
            const result = await pool.query(
                `INSERT INTO bills (tenant_id, property_id, room_id, bill_month, month_year, total_bill, previous_balance, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *`,
                [tenant_id, property_id, room_id, billMonthDate, monthYear, total_bill, previous_balance || 0, 'not_paid']
            );
            billId = result.rows[0].id;
            
            for (const item of items) {
                if (item.item_name && item.amount > 0) {
                    await pool.query(
                        'INSERT INTO bill_items (bill_id, item_name, amount) VALUES ($1, $2, $3)',
                        [billId, item.item_name, item.amount]
                    );
                }
            }
        }
        
        res.json({ success: true, billId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update bill
router.put('/:id', auth, async (req, res) => {
    const { previous_balance, items } = req.body;
    
    try {
        let total_bill = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
        total_bill += parseFloat(previous_balance) || 0;
        
        await pool.query(
            `UPDATE bills SET total_bill = $1, previous_balance = $2, updated_at = NOW() WHERE id = $3`,
            [total_bill, previous_balance || 0, req.params.id]
        );
        
        await pool.query('DELETE FROM bill_items WHERE bill_id = $1', [req.params.id]);
        
        for (const item of items) {
            if (item.item_name && item.amount > 0) {
                await pool.query(
                    'INSERT INTO bill_items (bill_id, item_name, amount) VALUES ($1, $2, $3)',
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

// Delete bill
router.delete('/:id', auth, async (req, res) => {
    try {
        const bill = await pool.query('SELECT total_paid FROM bills WHERE id = $1', [req.params.id]);
        if (bill.rows.length > 0 && bill.rows[0].total_paid > 0) {
            return res.status(400).json({ error: 'Cannot delete bill with payments applied' });
        }
        await pool.query('DELETE FROM bills WHERE id = $1', [req.params.id]);
        res.json({ message: 'Bill deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Auto-generate bills
router.post('/auto-generate', auth, async (req, res) => {
    try {
        const { month, year } = req.body;
        const billMonth = new Date(year, month - 1, 1);
        
        const tenants = await pool.query(`
            SELECT t.id, t.property_id, t.room_id, r.rent
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.is_deleted = FALSE AND r.status = 'occupied'
        `);
        
        let generated = 0;
        let skipped = 0;
        
        for (const tenant of tenants.rows) {
            const existing = await pool.query(
                'SELECT id FROM bills WHERE tenant_id = $1 AND bill_month = $2',
                [tenant.id, billMonth]
            );
            
            if (existing.rows.length > 0) {
                skipped++;
                continue;
            }
            
            const rentAmount = parseFloat(tenant.rent) || 0;
            
            const result = await pool.query(
                `INSERT INTO bills (tenant_id, property_id, room_id, bill_month, total_bill, status)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
                [tenant.id, tenant.property_id, tenant.room_id, billMonth, rentAmount, 'not_paid']
            );
            
            await pool.query(
                'INSERT INTO bill_items (bill_id, item_name, amount) VALUES ($1, $2, $3)',
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

// Bulk create bills
router.post('/bulk-property', auth, async (req, res) => {
    try {
        const { property_id, bill_month, item_name, amount } = req.body;
        const billMonthDate = new Date(bill_month);
        
        const tenants = await pool.query(`
            SELECT t.id, t.room_id
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.property_id = $1 AND t.is_deleted = FALSE AND r.status = 'occupied'
        `, [property_id]);
        
        let created = 0;
        let updated = 0;
        
        for (const tenant of tenants.rows) {
            const existingBill = await pool.query(
                'SELECT id, total_bill FROM bills WHERE tenant_id = $1 AND bill_month = $2',
                [tenant.id, billMonthDate]
            );
            
            if (existingBill.rows.length > 0) {
                const newTotal = parseFloat(existingBill.rows[0].total_bill) + amount;
                await pool.query(
                    `UPDATE bills SET total_bill = $1, updated_at = NOW() WHERE id = $2`,
                    [newTotal, existingBill.rows[0].id]
                );
                updated++;
            } else {
                await pool.query(
                    `INSERT INTO bills (tenant_id, property_id, room_id, bill_month, total_bill, status)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [tenant.id, property_id, tenant.room_id, billMonthDate, amount, 'not_paid']
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

// Award penalties
router.post('/award-penalties', auth, async (req, res) => {
    try {
        const { month, year } = req.body;
        const previousMonth = new Date(year, month - 2, 1);
        
        const tenantsWithArrears = await pool.query(`
            SELECT DISTINCT t.id, t.first_name, t.last_name, t.phone,
                   b.id as bill_id, b.total_bill, b.total_paid,
                   p.penalty_amount, r.house_no
            FROM tenants t
            JOIN bills b ON t.id = b.tenant_id
            JOIN properties p ON t.property_id = p.id
            JOIN rooms r ON t.room_id = r.id
            WHERE b.bill_month = $1 AND b.total_bill > b.total_paid AND t.is_deleted = FALSE
        `, [previousMonth]);
        
        let awarded = 0;
        
        for (const tenant of tenantsWithArrears.rows) {
            const penaltyAmount = parseFloat(tenant.penalty_amount) || 500;
            
            const existingPenalty = await pool.query(
                'SELECT id FROM penalty_log WHERE tenant_id = $1 AND month_year = $2',
                [tenant.id, previousMonth]
            );
            
            if (existingPenalty.rows.length > 0) continue;
            
            await pool.query(
                `UPDATE bills SET total_bill = total_bill + $1, penalty_amount = COALESCE(penalty_amount, 0) + $1 WHERE id = $2`,
                [penaltyAmount, tenant.bill_id]
            );
            
            await pool.query(
                `INSERT INTO penalty_log (tenant_id, bill_id, amount, awarded_date, month_year, message_sent)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [tenant.id, tenant.bill_id, penaltyAmount, new Date(), previousMonth, false]
            );
            
            awarded++;
        }
        
        res.json({ message: `Penalties awarded: ${awarded}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get tenant balance breakdown
router.get('/tenant-breakdown/:tenantId', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                bi.item_name,
                SUM(bi.amount) as amount
            FROM bills b
            JOIN bill_items bi ON b.id = bi.bill_id
            WHERE b.tenant_id = $1 AND b.total_bill > b.total_paid
            GROUP BY bi.item_name
        `, [req.params.tenantId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get tenant invoices
router.get('/tenant-invoices/:tenantId', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, 
                   (SELECT json_agg(json_build_object('item_name', bi.item_name, 'amount', bi.amount))
                    FROM bill_items bi WHERE bi.bill_id = b.id) as items
            FROM bills b
            WHERE b.tenant_id = $1
            ORDER BY b.bill_month DESC
        `, [req.params.tenantId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get tenant balance
router.get('/tenant-balance/:tenantId', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COALESCE(SUM(total_bill - total_paid), 0) as balance
            FROM bills
            WHERE tenant_id = $1
        `, [req.params.tenantId]);
        res.json({ balance: parseFloat(result.rows[0].balance) || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get filter data
router.get('/filters/data', auth, async (req, res) => {
    try {
        const properties = await pool.query('SELECT id, name FROM properties ORDER BY name');
        const tenants = await pool.query('SELECT id, first_name, last_name FROM tenants WHERE is_deleted = FALSE ORDER BY first_name');
        const rooms = await pool.query('SELECT id, house_no, property_id FROM rooms ORDER BY house_no');
        res.json({ properties: properties.rows, tenants: tenants.rows, rooms: rooms.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});
// Helper function to update bill status 
async function updateBillStatus(billId) {
    const result = await pool.query(
        `SELECT total_bill, total_paid FROM bills WHERE id = $1`,
        [billId]
    );
    
    if (result.rows.length === 0) return;
    
    const bill = result.rows[0];
    let status = 'not_paid';
    
    if (parseFloat(bill.total_paid) >= parseFloat(bill.total_bill)) {
        status = 'paid';
    } else if (parseFloat(bill.total_paid) > 0) {
        status = 'partially_paid';
    }
    
    await pool.query(
        `UPDATE bills SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, billId]
    );
}
module.exports = router;