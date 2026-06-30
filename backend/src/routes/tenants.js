const express = require('express');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const redis = require('../utils/redis');
const { blockViewerWrites, requireOwner } = require('../middleware/requireRole');

const router = express.Router();

router.use(auth, blockViewerWrites);

// Helper to update property counts
async function updatePropertyCounts(propertyId) {
    await pool.query(`
        UPDATE properties
        SET total_rooms    = (SELECT COUNT(*) FROM rooms WHERE property_id = $1),
            occupied_rooms = (SELECT COUNT(*) FROM rooms WHERE property_id = $1 AND status = 'occupied')
        WHERE id = $1
    `, [propertyId]);
}

// Helper — convert empty string to null
const toNullIfEmpty = (value) => {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    return value;
};

// GET all tenants (including vacated) — scoped to owner
router.get('/all', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name AS property_name, r.house_no, r.rent, r.status AS room_status
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.owner_id = $1
            ORDER BY t.id DESC
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET active tenants only
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name AS property_name, r.house_no, r.rent, r.status AS room_status
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.owner_id = $1 AND t.is_deleted = FALSE
            ORDER BY t.id DESC
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET single tenant — must belong to this owner
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.name AS property_name, p.location AS property_location,
                   r.house_no, r.rent, r.deposit, r.room_type, r.floor_number, r.status AS room_status
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.id = $1 AND t.owner_id = $2 AND t.is_deleted = FALSE
        `, [req.params.id, req.ownerId]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST add tenant
router.post('/', async (req, res) => {
    const {
        first_name, last_name, phone, email, national_id,
        front_id_image, back_id_image, property_id, room_id,
        account_number, move_in_date
    } = req.body;

    try {
        // Verify property belongs to this owner
        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [property_id, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        const existingPhone = await pool.query(
            'SELECT id FROM tenants WHERE phone = $1 AND is_deleted = FALSE AND owner_id = $2',
            [phone, req.ownerId]
        );
        if (existingPhone.rows.length > 0) return res.status(400).json({ error: 'Phone number already exists' });

        const cleanNationalId = toNullIfEmpty(national_id);
        if (cleanNationalId) {
            const existingId = await pool.query(
                'SELECT id FROM tenants WHERE national_id = $1 AND is_deleted = FALSE AND owner_id = $2',
                [cleanNationalId, req.ownerId]
            );
            if (existingId.rows.length > 0) return res.status(400).json({ error: 'National ID already exists' });
        }

        const existingAccount = await pool.query(
            'SELECT id FROM tenants WHERE account_number = $1 AND owner_id = $2',
            [account_number, req.ownerId]
        );
        if (existingAccount.rows.length > 0) return res.status(400).json({ error: 'Account number already exists' });

        // Verify room belongs to this owner's property
        const room = await pool.query(
            `SELECT r.id, r.status FROM rooms r
             JOIN properties p ON r.property_id = p.id
             WHERE r.id = $1 AND p.owner_id = $2`,
            [room_id, req.ownerId]
        );
        if (room.rows.length === 0) return res.status(400).json({ error: 'Room not found' });
        if (room.rows[0].status !== 'vacant') return res.status(400).json({ error: 'Room is not vacant' });

        const result = await pool.query(
            `INSERT INTO tenants
                (first_name, last_name, phone, email, national_id, front_id_image, back_id_image,
                 property_id, room_id, account_number, move_in_date, is_deleted, owner_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,$12) RETURNING *`,
            [
                first_name, last_name, phone,
                toNullIfEmpty(email), cleanNationalId,
                toNullIfEmpty(front_id_image), toNullIfEmpty(back_id_image),
                property_id, room_id, account_number,
                toNullIfEmpty(move_in_date), req.ownerId
            ]
        );

        await pool.query("UPDATE rooms SET status = 'occupied' WHERE id = $1", [room_id]);
        await updatePropertyCounts(property_id);
        await redis.del(`all_properties:${req.ownerId}`);
        await redis.del(`property:${req.ownerId}:${property_id}`);

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update tenant
router.put('/:id', async (req, res) => {
    const {
        first_name, last_name, phone, email, national_id,
        front_id_image, back_id_image, profile_image,
        property_id, room_id, account_number, move_in_date
    } = req.body;

    try {
        // Verify tenant belongs to this owner
        const tenantCheck = await pool.query(
            'SELECT id FROM tenants WHERE id = $1 AND owner_id = $2 AND is_deleted = FALSE',
            [req.params.id, req.ownerId]
        );
        if (tenantCheck.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        const existingPhone = await pool.query(
            'SELECT id FROM tenants WHERE phone = $1 AND id != $2 AND is_deleted = FALSE AND owner_id = $3',
            [phone, req.params.id, req.ownerId]
        );
        if (existingPhone.rows.length > 0) return res.status(400).json({ error: 'Phone number already exists' });

        const cleanNationalId = toNullIfEmpty(national_id);
        if (cleanNationalId) {
            const existingId = await pool.query(
                'SELECT id FROM tenants WHERE national_id = $1 AND id != $2 AND is_deleted = FALSE AND owner_id = $3',
                [cleanNationalId, req.params.id, req.ownerId]
            );
            if (existingId.rows.length > 0) return res.status(400).json({ error: 'National ID already exists' });
        }

        const oldTenant = await pool.query(
            'SELECT room_id, property_id FROM tenants WHERE id = $1',
            [req.params.id]
        );

        const result = await pool.query(
            `UPDATE tenants SET
                first_name = $1, last_name = $2, phone = $3, email = $4, national_id = $5,
                front_id_image = $6, back_id_image = $7, profile_image = $8,
                property_id = $9, room_id = $10, account_number = $11, move_in_date = $12
             WHERE id = $13 AND owner_id = $14 AND is_deleted = FALSE RETURNING *`,
            [
                first_name, last_name, phone,
                toNullIfEmpty(email), cleanNationalId,
                toNullIfEmpty(front_id_image), toNullIfEmpty(back_id_image), toNullIfEmpty(profile_image),
                property_id, room_id, account_number,
                toNullIfEmpty(move_in_date),
                req.params.id, req.ownerId
            ]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        if (oldTenant.rows[0].room_id !== room_id) {
            await pool.query("UPDATE rooms SET status = 'vacant'   WHERE id = $1", [oldTenant.rows[0].room_id]);
            await pool.query("UPDATE rooms SET status = 'occupied' WHERE id = $1", [room_id]);
            await updatePropertyCounts(oldTenant.rows[0].property_id);
            await updatePropertyCounts(property_id);
            await redis.del(`property:${req.ownerId}:${oldTenant.rows[0].property_id}`);
            await redis.del(`property:${req.ownerId}:${property_id}`);
        }

        await redis.del(`all_properties:${req.ownerId}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE (soft) tenant — owner only
router.delete('/:id', requireOwner, async (req, res) => {
    try {
        const tenant = await pool.query(
            'SELECT property_id, room_id FROM tenants WHERE id = $1 AND owner_id = $2 AND is_deleted = FALSE',
            [req.params.id, req.ownerId]
        );

        if (tenant.rows.length > 0) {
            await pool.query('UPDATE tenants SET is_deleted = TRUE WHERE id = $1', [req.params.id]);
            await pool.query("UPDATE rooms SET status = 'vacant' WHERE id = $1", [tenant.rows[0].room_id]);
            await updatePropertyCounts(tenant.rows[0].property_id);
            await redis.del(`all_properties:${req.ownerId}`);
            await redis.del(`property:${req.ownerId}:${tenant.rows[0].property_id}`);
        }

        res.json({ message: 'Tenant vacated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET available rooms for a property (tenant add form)
router.get('/available-rooms/:propertyId', async (req, res) => {
    try {
        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [req.params.propertyId, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        const result = await pool.query(
            "SELECT * FROM rooms WHERE property_id = $1 AND status = 'vacant' ORDER BY house_no",
            [req.params.propertyId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET additional bills for a tenant
router.get('/:tenantId/additional-bills', async (req, res) => {
    try {
        // Verify tenant ownership
        const tenant = await pool.query(
            'SELECT id FROM tenants WHERE id = $1 AND owner_id = $2',
            [req.params.tenantId, req.ownerId]
        );
        if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        const result = await pool.query(
            'SELECT bill_name FROM tenant_additional_bills WHERE tenant_id = $1 ORDER BY id',
            [req.params.tenantId]
        );
        res.json(result.rows.map(row => row.bill_name));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST save additional bills for a tenant
router.post('/:tenantId/additional-bills', async (req, res) => {
    const { bills } = req.body;
    try {
        const tenant = await pool.query(
            'SELECT id FROM tenants WHERE id = $1 AND owner_id = $2',
            [req.params.tenantId, req.ownerId]
        );
        if (tenant.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        await pool.query('DELETE FROM tenant_additional_bills WHERE tenant_id = $1', [req.params.tenantId]);
        for (const billName of bills) {
            if (billName && billName.trim()) {
                await pool.query(
                    'INSERT INTO tenant_additional_bills (tenant_id, bill_name) VALUES ($1, $2)',
                    [req.params.tenantId, billName.trim()]
                );
            }
        }
        res.json({ message: 'Additional bills saved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
