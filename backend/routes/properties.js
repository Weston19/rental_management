const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const redis = require('../redis');

const router = express.Router();

// Get all properties
router.get('/', auth, async (req, res) => {
    const cacheKey = 'all_properties';
    
    try {
        // Check cache first
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }
        
        // Query Supabase
        const result = await pool.query(`
            SELECT p.*, 
                   COALESCE(SUM(r.rent), 0) as total_rent,
                   COUNT(r.id) as total_units
            FROM properties p
            LEFT JOIN rooms r ON p.id = r.property_id
            GROUP BY p.id
            ORDER BY p.id DESC
        `);
        
        // Cache the result
        await redis.set(cacheKey, JSON.stringify(result.rows), { ex: 3600 });
        
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single property
router.get('/:id', auth, async (req, res) => {
    const cacheKey = `property:${req.params.id}`;
    
    try {
        // Check cache first
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }
        
        // Query Supabase
        const property = await pool.query(`
            SELECT p.*, 
                   COALESCE(SUM(r.rent), 0) as total_rent,
                   COUNT(r.id) as total_units,
                   COUNT(CASE WHEN r.status = 'occupied' THEN 1 END) as occupied_count
            FROM properties p
            LEFT JOIN rooms r ON p.id = r.property_id
            WHERE p.id = $1
            GROUP BY p.id
        `, [req.params.id]);
        
        if (property.rows.length === 0) {
            return res.status(404).json({ error: 'Property not found' });
        }
        
        const rooms = await pool.query(`
            SELECT r.*, 
                   t.first_name || ' ' || t.last_name as tenant_name,
                   t.phone as tenant_phone
            FROM rooms r
            LEFT JOIN tenants t ON r.id = t.room_id AND t.is_deleted = FALSE
            WHERE r.property_id = $1
            ORDER BY r.house_no
        `, [req.params.id]);
        
        const data = { ...property.rows[0], rooms: rooms.rows };
        
        // Cache the result
        await redis.set(cacheKey, JSON.stringify(data), { ex: 3600 });
        
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add property
router.post('/', auth, async (req, res) => {
    const { name, location, landlord_name, total_rooms, occupied_rooms, billing_day, penalty_amount, image_url } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO properties (name, location, landlord_name, total_rooms, occupied_rooms, billing_day, penalty_amount, image_url) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, location, landlord_name, total_rooms || 0, occupied_rooms || 0, billing_day || 1, penalty_amount || 0, image_url]
        );
        
        // Invalidate cache
        await redis.del('all_properties');
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update property
router.put('/:id', auth, async (req, res) => {
    const { name, location, landlord_name, total_rooms, occupied_rooms, billing_day, penalty_amount, image_url } = req.body;
    
    try {
        const result = await pool.query(
            `UPDATE properties SET 
                name = $1, location = $2, landlord_name = $3, 
                total_rooms = $4, occupied_rooms = $5, 
                billing_day = $6, penalty_amount = $7, image_url = $8 
             WHERE id = $9 RETURNING *`,
            [name, location, landlord_name, total_rooms, occupied_rooms, billing_day, penalty_amount, image_url, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Property not found' });
        }
        
        // Invalidate cache
        await redis.del('all_properties');
        await redis.del(`property:${req.params.id}`);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete property
router.delete('/:id', auth, async (req, res) => {
    try {
        // Check if property exists
        const property = await pool.query('SELECT id FROM properties WHERE id = $1', [req.params.id]);
        if (property.rows.length === 0) {
            return res.status(404).json({ error: 'Property not found' });
        }
        
        // Delete property (cascade will delete rooms)
        await pool.query('DELETE FROM properties WHERE id = $1', [req.params.id]);
        
        // Invalidate cache
        await redis.del('all_properties');
        await redis.del(`property:${req.params.id}`);
        
        res.json({ message: 'Property deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});
// Get rooms by property
router.get('/:propertyId/rooms', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.*, 
                    t.first_name || ' ' || t.last_name as tenant_name,
                    t.phone as tenant_phone
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

// Add room to property
router.post('/:propertyId/rooms', auth, async (req, res) => {
    const { propertyId } = req.params;
    const { house_no, room_type, status, deposit, rent, floor_number, image_url } = req.body;
    
    try {
        if (!house_no || house_no.trim() === '') {
            return res.status(400).json({ error: 'Unit name is required' });
        }
        
        if (!rent || rent <= 0) {
            return res.status(400).json({ error: 'Rent amount must be greater than 0' });
        }
        
        if (!deposit || deposit <= 0) {
            return res.status(400).json({ error: 'Deposit amount must be greater than 0' });
        }
        
        const existing = await pool.query(
            'SELECT * FROM rooms WHERE property_id = $1 AND house_no = $2',
            [propertyId, house_no]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'House number already exists' });
        }
        
        const property = await pool.query('SELECT total_rooms FROM properties WHERE id = $1', [propertyId]);
        const currentRooms = await pool.query('SELECT COUNT(*) FROM rooms WHERE property_id = $1', [propertyId]);
        
        if (parseInt(currentRooms.rows[0].count) >= parseInt(property.rows[0].total_rooms)) {
            return res.status(400).json({ error: `Maximum ${property.rows[0].total_rooms} rooms reached` });
        }
        
        const result = await pool.query(
            `INSERT INTO rooms (property_id, house_no, room_type, status, deposit, rent, floor_number, image_url) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [propertyId, house_no.trim(), room_type, status || 'vacant', deposit, rent, floor_number || 0, image_url]
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single room
router.get('/room/:roomId', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.*, p.name as property_name 
             FROM rooms r
             LEFT JOIN properties p ON r.property_id = p.id
             WHERE r.id = $1`,
            [req.params.roomId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update room
router.put('/room/:roomId', auth, async (req, res) => {
    const { house_no, room_type, status, deposit, rent, floor_number, image_url } = req.body;
    const { roomId } = req.params;
    
    try {
        if (!house_no || house_no.trim() === '') {
            return res.status(400).json({ error: 'Unit name is required' });
        }
        
        if (!rent || rent <= 0) {
            return res.status(400).json({ error: 'Rent amount must be greater than 0' });
        }
        
        if (!deposit || deposit <= 0) {
            return res.status(400).json({ error: 'Deposit amount must be greater than 0' });
        }
        
        const currentRoom = await pool.query('SELECT property_id FROM rooms WHERE id = $1', [roomId]);
        if (currentRoom.rows.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }
        
        const existing = await pool.query(
            'SELECT * FROM rooms WHERE property_id = $1 AND house_no = $2 AND id != $3',
            [currentRoom.rows[0].property_id, house_no, roomId]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'House number already exists' });
        }
        
        const result = await pool.query(
            `UPDATE rooms 
             SET house_no = $1, room_type = $2, status = $3, deposit = $4, rent = $5, floor_number = $6, image_url = $7
             WHERE id = $8 RETURNING *`,
            [house_no.trim(), room_type, status, deposit, rent, floor_number || 0, image_url, roomId]
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete room
router.delete('/room/:roomId', auth, async (req, res) => {
    console.log('🗑️ Delete room called for ID:', req.params.roomId);
    
    try {
        // Get room info
        const room = await pool.query('SELECT property_id FROM rooms WHERE id = $1', [req.params.roomId]);
        
        if (room.rows.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }
        
        // Check if room has active tenant (not vacated)
        const tenant = await pool.query('SELECT id FROM tenants WHERE room_id = $1 AND is_deleted = FALSE LIMIT 1', [req.params.roomId]);
        if (tenant.rows.length > 0) {
            return res.status(400).json({ error: 'Cannot delete room with active tenant. Vacate the tenant first.' });
        }
        
        // Delete the room
        await pool.query('DELETE FROM rooms WHERE id = $1', [req.params.roomId]);
        
        // Update property total_rooms count
        await pool.query('UPDATE properties SET total_rooms = total_rooms - 1 WHERE id = $1', [room.rows[0].property_id]);
        
        console.log('✅ Room deleted successfully');
        res.json({ message: 'Room deleted successfully' });
    } catch (error) {
        console.error('❌ Delete room error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

module.exports = router;