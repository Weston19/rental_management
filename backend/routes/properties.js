const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const redis = require('../redis');
const { blockViewerWrites, requireOwner } = require('../middleware/requireRole');

const router = express.Router();

// Block viewers from all write operations on this router
router.use(auth, blockViewerWrites);

// Helper to update property counts
async function updatePropertyCounts(propertyId) {
    await pool.query(`
        UPDATE properties
        SET total_rooms    = (SELECT COUNT(*)    FROM rooms WHERE property_id = $1),
            occupied_rooms = (SELECT COUNT(*)    FROM rooms WHERE property_id = $1 AND status = 'occupied')
        WHERE id = $1
    `, [propertyId]);
}

// GET all properties — scoped to ownerId
router.get('/', async (req, res) => {
    const cacheKey = `all_properties:${req.ownerId}`;

    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

        const result = await pool.query(`
            SELECT p.*,
                   COALESCE(SUM(r.rent), 0) AS total_rent,
                   COUNT(r.id)              AS total_units
            FROM properties p
            LEFT JOIN rooms r ON p.id = r.property_id
            WHERE p.owner_id = $1
            GROUP BY p.id
            ORDER BY p.id DESC
        `, [req.ownerId]);

        await redis.set(cacheKey, JSON.stringify(result.rows), { ex: 3600 });
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET single property — must belong to this owner
router.get('/:id', async (req, res) => {
    const cacheKey = `property:${req.ownerId}:${req.params.id}`;

    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

        const property = await pool.query(`
            SELECT p.*,
                   COALESCE(SUM(r.rent), 0) AS total_rent,
                   COUNT(r.id)              AS total_units,
                   COUNT(CASE WHEN r.status = 'occupied' THEN 1 END) AS occupied_count
            FROM properties p
            LEFT JOIN rooms r ON p.id = r.property_id
            WHERE p.id = $1 AND p.owner_id = $2
            GROUP BY p.id
        `, [req.params.id, req.ownerId]);

        if (property.rows.length === 0) {
            return res.status(404).json({ error: 'Property not found' });
        }

        const rooms = await pool.query(`
            SELECT r.*,
                   t.first_name || ' ' || t.last_name AS tenant_name,
                   t.phone AS tenant_phone
            FROM rooms r
            LEFT JOIN tenants t ON r.id = t.room_id AND t.is_deleted = FALSE
            WHERE r.property_id = $1
            ORDER BY r.house_no
        `, [req.params.id]);

        const data = { ...property.rows[0], rooms: rooms.rows };
        await redis.set(cacheKey, JSON.stringify(data), { ex: 3600 });
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST add property
router.post('/', async (req, res) => {
    const { name, location, landlord_name, billing_day, penalty_amount, image_url } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO properties
                (name, location, landlord_name, total_rooms, occupied_rooms, billing_day, penalty_amount, image_url, owner_id)
             VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7) RETURNING *`,
            [name, location, landlord_name, billing_day || 1, penalty_amount || 0, image_url, req.ownerId]
        );

        await redis.del(`all_properties:${req.ownerId}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update property — owner-scoped
router.put('/:id', async (req, res) => {
    const { name, location, landlord_name, billing_day, penalty_amount, image_url } = req.body;

    try {
        const result = await pool.query(
            `UPDATE properties
             SET name = $1, location = $2, landlord_name = $3,
                 billing_day = $4, penalty_amount = $5, image_url = $6
             WHERE id = $7 AND owner_id = $8
             RETURNING *`,
            [name, location, landlord_name, billing_day, penalty_amount, image_url, req.params.id, req.ownerId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Property not found' });
        }

        await redis.del(`all_properties:${req.ownerId}`);
        await redis.del(`property:${req.ownerId}:${req.params.id}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE property — owner only
router.delete('/:id', requireOwner, async (req, res) => {
    try {
        const property = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (property.rows.length === 0) {
            return res.status(404).json({ error: 'Property not found' });
        }

        await pool.query('DELETE FROM properties WHERE id = $1', [req.params.id]);

        await redis.del(`all_properties:${req.ownerId}`);
        await redis.del(`property:${req.ownerId}:${req.params.id}`);
        res.json({ message: 'Property deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET rooms by property — ownership verified via property
router.get('/:propertyId/rooms', async (req, res) => {
    try {
        // Verify property belongs to this owner first
        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [req.params.propertyId, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        const result = await pool.query(
            `SELECT r.*,
                    t.first_name || ' ' || t.last_name AS tenant_name,
                    t.phone AS tenant_phone
             FROM rooms r
             LEFT JOIN tenants t ON r.id = t.room_id AND t.is_deleted = FALSE
             WHERE r.property_id = $1
             ORDER BY r.house_no`,
            [req.params.propertyId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST add room to property
router.post('/:propertyId/rooms', async (req, res) => {
    const { propertyId } = req.params;
    const { house_no, room_type, status, deposit, rent, floor_number, image_url } = req.body;

    try {
        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [propertyId, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        if (!house_no || house_no.trim() === '') return res.status(400).json({ error: 'Unit name is required' });
        if (!rent || rent <= 0)                    return res.status(400).json({ error: 'Rent amount must be greater than 0' });
        if (!deposit || deposit <= 0)              return res.status(400).json({ error: 'Deposit amount must be greater than 0' });

        const existing = await pool.query(
            'SELECT id FROM rooms WHERE property_id = $1 AND house_no = $2',
            [propertyId, house_no]
        );
        if (existing.rows.length > 0) return res.status(400).json({ error: 'House number already exists' });

        const result = await pool.query(
            `INSERT INTO rooms (property_id, house_no, room_type, status, deposit, rent, floor_number, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [propertyId, house_no.trim(), room_type, status || 'vacant', deposit, rent, floor_number || 0, image_url]
        );

        await updatePropertyCounts(propertyId);
        await redis.del(`all_properties:${req.ownerId}`);
        await redis.del(`property:${req.ownerId}:${propertyId}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET single room — ownership verified via property join
router.get('/room/:roomId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.*, p.name AS property_name
             FROM rooms r
             LEFT JOIN properties p ON r.property_id = p.id
             WHERE r.id = $1 AND p.owner_id = $2`,
            [req.params.roomId, req.ownerId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Room not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update room
router.put('/room/:roomId', async (req, res) => {
    const { house_no, room_type, status, deposit, rent, floor_number, image_url } = req.body;
    const { roomId } = req.params;

    try {
        if (!house_no || house_no.trim() === '') return res.status(400).json({ error: 'Unit name is required' });
        if (!rent || rent <= 0)                    return res.status(400).json({ error: 'Rent amount must be greater than 0' });
        if (!deposit || deposit <= 0)              return res.status(400).json({ error: 'Deposit amount must be greater than 0' });

        // Verify room belongs to this owner via property
        const currentRoom = await pool.query(
            `SELECT r.property_id FROM rooms r
             JOIN properties p ON r.property_id = p.id
             WHERE r.id = $1 AND p.owner_id = $2`,
            [roomId, req.ownerId]
        );
        if (currentRoom.rows.length === 0) return res.status(404).json({ error: 'Room not found' });

        const propertyId = currentRoom.rows[0].property_id;

        const existing = await pool.query(
            'SELECT id FROM rooms WHERE property_id = $1 AND house_no = $2 AND id != $3',
            [propertyId, house_no, roomId]
        );
        if (existing.rows.length > 0) return res.status(400).json({ error: 'House number already exists' });

        const result = await pool.query(
            `UPDATE rooms
             SET house_no = $1, room_type = $2, status = $3, deposit = $4, rent = $5, floor_number = $6, image_url = $7
             WHERE id = $8 RETURNING *`,
            [house_no.trim(), room_type, status, deposit, rent, floor_number || 0, image_url, roomId]
        );

        await updatePropertyCounts(propertyId);
        await redis.del(`all_properties:${req.ownerId}`);
        await redis.del(`property:${req.ownerId}:${propertyId}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE room — owner only
router.delete('/room/:roomId', requireOwner, async (req, res) => {
    try {
        const room = await pool.query(
            `SELECT r.property_id FROM rooms r
             JOIN properties p ON r.property_id = p.id
             WHERE r.id = $1 AND p.owner_id = $2`,
            [req.params.roomId, req.ownerId]
        );
        if (room.rows.length === 0) return res.status(404).json({ error: 'Room not found' });

        const tenant = await pool.query(
            'SELECT id FROM tenants WHERE room_id = $1 AND is_deleted = FALSE LIMIT 1',
            [req.params.roomId]
        );
        if (tenant.rows.length > 0) {
            return res.status(400).json({ error: 'Cannot delete room with active tenant. Vacate the tenant first.' });
        }

        const propertyId = room.rows[0].property_id;
        await pool.query('DELETE FROM rooms WHERE id = $1', [req.params.roomId]);
        await updatePropertyCounts(propertyId);
        await redis.del(`all_properties:${req.ownerId}`);
        await redis.del(`property:${req.ownerId}:${propertyId}`);
        res.json({ message: 'Room deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
