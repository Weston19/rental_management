const express = require('express');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const { blockViewerWrites } = require('../middleware/requireRole');

const router = express.Router();

router.use(auth, blockViewerWrites);

// GET all rooms — scoped to owner via property join
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.*, p.name AS property_name
            FROM rooms r
            LEFT JOIN properties p ON r.property_id = p.id
            WHERE p.owner_id = $1
            ORDER BY p.name, r.house_no
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET rooms by property — ownership verified via property
router.get('/property/:propertyId', async (req, res) => {
    try {
        const prop = await pool.query(
            'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
            [req.params.propertyId, req.ownerId]
        );
        if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

        const result = await pool.query(
            'SELECT * FROM rooms WHERE property_id = $1 ORDER BY house_no',
            [req.params.propertyId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET vacant rooms by property
router.get('/available/:propertyId', async (req, res) => {
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

module.exports = router;
