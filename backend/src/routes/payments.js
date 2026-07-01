const express = require('express');
const multer = require('multer');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const redis = require('../utils/redis');
const bcrypt = require('bcrypt');
const { blockViewerWrites, requireOwner } = require('../middleware/requireRole');

// Configure multer for file uploads (in-memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// Tiered Redis TTLs (in seconds)
const TTL = {
    STATIC: 86400,    // 24 hours
    SLOW: 3600,       // 1 hour
    MEDIUM: 600,       // 10 minutes
    FAST: 120         // 2 minutes
};

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
    const cacheKey = `all_payments:${req.ownerId}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

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
        
        await redis.set(cacheKey, JSON.stringify(result.rows), { ex: TTL.FAST });
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// GET single payment — ownership enforced
router.get('/:id', async (req, res) => {
    const cacheKey = `payment:${req.ownerId}:${req.params.id}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

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
        
        await redis.set(cacheKey, JSON.stringify(result.rows[0]), { ex: TTL.FAST });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// GET payments by tenant — ownership enforced
router.get('/tenant/:tenantId', async (req, res) => {
    const cacheKey = `tenant_payments:${req.ownerId}:${req.params.tenantId}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

        const tenantCheck = await pool.query(
            'SELECT id FROM tenants WHERE id = $1 AND owner_id = $2',
            [req.params.tenantId, req.ownerId]
        );
        if (tenantCheck.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        const result = await pool.query(
            'SELECT * FROM payments WHERE tenant_id = $1 AND owner_id = $2 ORDER BY payment_date DESC',
            [req.params.tenantId, req.ownerId]
        );
        
        await redis.set(cacheKey, JSON.stringify(result.rows), { ex: TTL.FAST });
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
        await redis.del(`all_payments:${req.ownerId}`);
        await redis.del(`tenant_payments:${req.ownerId}:${tenant_id}`);
        await redis.del(`all_bills:${req.ownerId}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// PUT update payment — manager+
router.put('/:id', async (req, res) => {
    const { amount, payment_date, payment_type, transaction_id, notes, password, reason } = req.body;

    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const valid = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid password' });

        const payment = await assertPaymentOwnership(req.params.id, req.ownerId);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });

        const numericAmount = parseAmount(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        // Recalculate bills after edit
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Update payment
            const result = await client.query(
                `UPDATE payments
                 SET amount = $1, payment_date = $2, payment_type = $3, transaction_id = $4,
                     notes = $5, edited_by = $6, edit_reason = $7, edit_count = edit_count + 1
                 WHERE id = $8 AND owner_id = $9 RETURNING *`,
                [numericAmount, payment_date, payment_type, transaction_id, notes,
                 req.adminId, reason, req.params.id, req.ownerId]
            );
            
            // Recalculate tenant's bills and balance
            const tenantId = result.rows[0].tenant_id;
            await client.query(`
                UPDATE bills
                SET total_paid = (
                    SELECT COALESCE(SUM(amount), 0)
                    FROM payments
                    WHERE tenant_id = bills.tenant_id AND payment_date <= bills.bill_month + INTERVAL '1 month'
                ), updated_at = NOW()
                WHERE tenant_id = $1`, [tenantId]);
            
            await updateTenantBalance(tenantId, client);
            await client.query('COMMIT');
            
            // Clear caches
            await redis.del(`all_payments:${req.ownerId}`);
            await redis.del(`payment:${req.ownerId}:${req.params.id}`);
            await redis.del(`tenant_payments:${req.ownerId}:${tenantId}`);
            await redis.del(`all_bills:${req.ownerId}`);
            
            res.json(result.rows[0]);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
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
        await redis.del(`all_payments:${req.ownerId}`);
        await redis.del(`payment:${req.ownerId}:${req.params.id}`);
        await redis.del(`tenant_payments:${req.ownerId}:${payment.tenant_id}`);
        await redis.del(`all_bills:${req.ownerId}`);
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

// POST import payments from CSV
router.post('/import', upload.single('csvFile'), async (req, res) => {
    const { password } = req.body;
    
    try {
        // Verify admin password
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        if (!admin.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
        const valid = await bcrypt.compare(password, admin.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid password' });

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Parse CSV content
        const csvContent = req.file.buffer.toString('utf8');
        const lines = csvContent.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
            return res.status(400).json({ error: 'CSV file must contain at least a header and one data row' });
        }

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        
        // Validate required headers
        const requiredHeaders = ['tenant', 'property', 'unit', 'amount', 'payment date', 'type', 'source', 'transaction id', 'notes'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        
        if (missingHeaders.length > 0) {
            return res.status(400).json({ error: `Missing required headers: ${missingHeaders.join(', ')}` });
        }

        const results = {
            imported: 0,
            skipped: 0,
            errors: []
        };

        // Process each row
        for (let i = 1; i < lines.length; i++) {
            try {
                // Simple CSV parsing (handles quoted fields)
                const row = parseCSVLine(lines[i]);
                const rowData = {};
                headers.forEach((header, index) => {
                    rowData[header] = row[index] || '';
                });

                // Find tenant by name, property, and unit
                const tenantResult = await pool.query(`
                    SELECT t.id 
                    FROM tenants t
                    JOIN properties p ON t.property_id = p.id
                    JOIN rooms r ON t.room_id = r.id
                    WHERE 
                        t.owner_id = $1 AND
                        CONCAT(t.first_name, ' ', t.last_name) ILIKE $2 AND
                        p.name ILIKE $3 AND
                        r.house_no ILIKE $4
                `, [req.ownerId, rowData['tenant'], rowData['property'], rowData['unit']]);

                if (tenantResult.rows.length === 0) {
                    results.skipped++;
                    results.errors.push(`Row ${i + 1}: Tenant "${rowData['tenant']}" in "${rowData['property']}" unit "${rowData['unit']}" not found`);
                    continue;
                }

                const tenantId = tenantResult.rows[0].id;
                const amount = parseAmount(rowData['amount']);
                
                if (isNaN(amount) || amount <= 0) {
                    results.skipped++;
                    results.errors.push(`Row ${i + 1}: Invalid amount "${rowData['amount']}"`);
                    continue;
                }

                // Check for duplicate transaction ID
                if (rowData['transaction id']) {
                    const dup = await pool.query(
                        'SELECT id FROM payments WHERE transaction_id = $1',
                        [rowData['transaction id']]
                    );
                    if (dup.rows.length > 0) {
                        results.skipped++;
                        results.errors.push(`Row ${i + 1}: Transaction ID "${rowData['transaction id']}" already exists`);
                        continue;
                    }
                }

                // Insert payment
                await pool.query(
                    `INSERT INTO payments
                        (tenant_id, amount, payment_date, payment_type, transaction_id, notes, source, owner_id)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [
                        tenantId, 
                        amount, 
                        rowData['payment date'] || new Date(),
                        rowData['type'] || 'rent',
                        rowData['transaction id'] || null,
                        rowData['notes'],
                        rowData['source'] || 'manual',
                        req.ownerId
                    ]
                );

                await applyPaymentToBills(tenantId, amount, req.ownerId);
                results.imported++;

            } catch (rowError) {
                results.skipped++;
                results.errors.push(`Row ${i + 1}: ${rowError.message}`);
            }
        }

        // Clear caches
        await redis.del(`all_payments:${req.ownerId}`);
        await redis.del(`all_bills:${req.ownerId}`);
        
        // Clear any tenant-specific payment caches
        const keys = await redis.keys(`tenant_payments:${req.ownerId}:*`);
        if (keys.length > 0) {
            await redis.del(...keys);
        }

        res.json(results);

    } catch (error) {
        console.error('CSV import error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper: Parse CSV line handling quoted fields
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

module.exports = router;
