const express = require('express');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const redis = require('../utils/redis');
const { blockViewerWrites } = require('../middleware/requireRole');

// Tiered Redis TTLs (in seconds)
const TTL = {
    STATIC: 86400,    // 24 hours for rarely changing data
    SLOW: 3600,       // 1 hour for properties, rooms
    MEDIUM: 600,      // 10 minutes for tenants
    FAST: 120         // 2 minutes for payments, bills, financials
};

const router = express.Router();

router.use(auth, blockViewerWrites);

// GET all rooms — scoped to owner via property join
router.get('/', async (req, res) => {
    const cacheKey = `all_rooms:${req.ownerId}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

        const result = await pool.query(`
            SELECT r.*, p.name AS property_name
            FROM rooms r
            LEFT JOIN properties p ON r.property_id = p.id
            WHERE p.owner_id = $1
            ORDER BY p.name, r.house_no
        `, [req.ownerId]);
        
        await redis.set(cacheKey, JSON.stringify(result.rows), { ex: TTL.SLOW });
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET rooms by property — ownership verified via property
router.get('/property/:propertyId', async (req, res) => {
    const cacheKey = `rooms_by_property:${req.ownerId}:${req.params.propertyId}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [req.params.propertyId, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        const result = await pool.query(
            'SELECT * FROM rooms WHERE property_id = $1 ORDER BY house_no',
            [req.params.propertyId]
        );
        
        await redis.set(cacheKey, JSON.stringify(result.rows), { ex: TTL.SLOW });
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET vacant rooms by property
router.get('/available/:propertyId', async (req, res) => {
    const cacheKey = `available_rooms:${req.ownerId}:${req.params.propertyId}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(typeof cached === 'string' ? JSON.parse(cached) : cached);
        }

        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [req.params.propertyId, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        const result = await pool.query(
            "SELECT * FROM rooms WHERE property_id = $1 AND status = 'vacant' ORDER BY house_no",
            [req.params.propertyId]
        );
        
        await redis.set(cacheKey, JSON.stringify(result.rows), { ex: TTL.SLOW });
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
