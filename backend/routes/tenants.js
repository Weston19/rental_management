const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all tenants (including vacated)
router.get('/all', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as property_name, r.house_no, r.rent, r.status as room_status
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY t.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get active tenants only
router.get('/', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as property_name, r.house_no, r.rent, r.status as room_status
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.is_deleted = FALSE
            ORDER BY t.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single tenant
router.get('/:id', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name as property_name, p.location as property_location,
                   r.house_no, r.rent, r.deposit, r.room_type, r.floor_number, r.status as room_status
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.id = $1 AND t.is_deleted = FALSE
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});


// Helper to convert empty string to null
const toNullIfEmpty = (value) => {
    if (value === undefined || value === null || value.trim() === '') {
        return null;
    }
    return value;
};

// Add tenant - fname,lastname,phone required
router.post('/', auth, async (req, res) => {
    const { 
        first_name, last_name, phone, email, national_id, 
        front_id_image, back_id_image, property_id, room_id, 
        account_number, move_in_date 
    } = req.body;
    
    try {
        // Check if phone number already exists
        const existingPhone = await pool.query('SELECT * FROM tenants WHERE phone = $1 AND is_deleted = FALSE', [phone]);
        if (existingPhone.rows.length > 0) {
            return res.status(400).json({ error: 'Phone number already exists' });
        }
        
        const cleanNationalId = toNullIfEmpty(national_id);
        
        // Check if national ID exists (only if provided)
        if (cleanNationalId) {
            const existingId = await pool.query('SELECT * FROM tenants WHERE national_id = $1 AND is_deleted = FALSE', [cleanNationalId]);
            if (existingId.rows.length > 0) {
                return res.status(400).json({ error: 'National ID already exists' });
            }
        }
        
        // Check if account number is unique
        const existingAccount = await pool.query('SELECT * FROM tenants WHERE account_number = $1', [account_number]);
        if (existingAccount.rows.length > 0) {
            return res.status(400).json({ error: 'Account number already exists' });
        }
        
        // Check if room is available
        const room = await pool.query('SELECT * FROM rooms WHERE id = $1', [room_id]);
        if (room.rows.length === 0) {
            return res.status(400).json({ error: 'Room not found' });
        }
        if (room.rows[0].status !== 'vacant') {
            return res.status(400).json({ error: 'Room is not vacant' });
        }
        
        // Insert tenant
        const result = await pool.query(
            `INSERT INTO tenants 
            (first_name, last_name, phone, email, national_id, front_id_image, back_id_image, property_id, room_id, account_number, move_in_date, is_deleted) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE) RETURNING *`,
            [
                first_name, 
                last_name, 
                phone, 
                toNullIfEmpty(email), 
                cleanNationalId, 
                toNullIfEmpty(front_id_image), 
                toNullIfEmpty(back_id_image), 
                property_id, 
                room_id, 
                account_number, 
                toNullIfEmpty(move_in_date)
            ]
        );
        
        // Update room status to occupied
        await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['occupied', room_id]);
        
        // Update property occupied_rooms count
        await pool.query('UPDATE properties SET occupied_rooms = occupied_rooms + 1 WHERE id = $1', [property_id]);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update tenant
router.put('/:id', auth, async (req, res) => {
    const { 
        first_name, last_name, phone, email, national_id, 
        front_id_image, back_id_image, profile_image,
        property_id, room_id, account_number, move_in_date 
    } = req.body;
    
    try {
        const existingPhone = await pool.query('SELECT * FROM tenants WHERE phone = $1 AND id != $2 AND is_deleted = FALSE', [phone, req.params.id]);
        if (existingPhone.rows.length > 0) {
            return res.status(400).json({ error: 'Phone number already exists' });
        }
        
        const cleanNationalId = toNullIfEmpty(national_id);
        
        const existingId = await pool.query('SELECT * FROM tenants WHERE national_id = $1 AND id != $2 AND is_deleted = FALSE', [cleanNationalId, req.params.id]);
        if (existingId.rows.length > 0 && cleanNationalId) {
            return res.status(400).json({ error: 'National ID already exists' });
        }
        
        const oldTenant = await pool.query('SELECT room_id, property_id FROM tenants WHERE id = $1', [req.params.id]);
        
        const result = await pool.query(
            `UPDATE tenants SET 
                first_name = $1, last_name = $2, phone = $3, email = $4, national_id = $5,
                front_id_image = $6, back_id_image = $7, profile_image = $8,
                property_id = $9, room_id = $10, account_number = $11, move_in_date = $12
             WHERE id = $13 AND is_deleted = FALSE RETURNING *`,
            [
                first_name, 
                last_name, 
                phone, 
                toNullIfEmpty(email), 
                cleanNationalId, 
                toNullIfEmpty(front_id_image), 
                toNullIfEmpty(back_id_image), 
                toNullIfEmpty(profile_image), 
                property_id, 
                room_id, 
                account_number, 
                toNullIfEmpty(move_in_date), 
                req.params.id
            ]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        if (oldTenant.rows[0].room_id !== room_id) {
            await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['vacant', oldTenant.rows[0].room_id]);
            await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['occupied', room_id]);
            await pool.query('UPDATE properties SET occupied_rooms = occupied_rooms - 1 WHERE id = $1', [oldTenant.rows[0].property_id]);
            await pool.query('UPDATE properties SET occupied_rooms = occupied_rooms + 1 WHERE id = $1', [property_id]);
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Soft delete tenant
router.delete('/:id', auth, async (req, res) => {
    try {
        const tenant = await pool.query('SELECT property_id, room_id FROM tenants WHERE id = $1 AND is_deleted = FALSE', [req.params.id]);
        
        if (tenant.rows.length > 0) {
            await pool.query('UPDATE tenants SET is_deleted = TRUE WHERE id = $1', [req.params.id]);
            await pool.query('UPDATE rooms SET status = $1 WHERE id = $2', ['vacant', tenant.rows[0].room_id]);
            await pool.query('UPDATE properties SET occupied_rooms = occupied_rooms - 1 WHERE id = $1', [tenant.rows[0].property_id]);
        }
        
        res.json({ message: 'Tenant vacated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get available rooms for a property
router.get('/available-rooms/:propertyId', auth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM rooms WHERE property_id = $1 AND status = $2 ORDER BY house_no',
            [req.params.propertyId, 'vacant']
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Additional bills endpoints
router.get('/:tenantId/additional-bills', auth, async (req, res) => {
    const { tenantId } = req.params;
    try {
        const result = await pool.query('SELECT bill_name FROM tenant_additional_bills WHERE tenant_id = $1 ORDER BY id', [tenantId]);
        res.json(result.rows.map(row => row.bill_name));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/:tenantId/additional-bills', auth, async (req, res) => {
    const { tenantId } = req.params;
    const { bills } = req.body;
    try {
        await pool.query('DELETE FROM tenant_additional_bills WHERE tenant_id = $1', [tenantId]);
        for (const billName of bills) {
            if (billName && billName.trim()) {
                await pool.query('INSERT INTO tenant_additional_bills (tenant_id, bill_name) VALUES ($1, $2)', [tenantId, billName.trim()]);
            }
        }
        res.json({ message: 'Additional bills saved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;