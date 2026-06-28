const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all rooms
router.get('/', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.*, p.name as property_name 
            FROM rooms r
            LEFT JOIN properties p ON r.property_id = p.id
            ORDER BY p.name, r.house_no
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get rooms by property
router.get('/property/:propertyId', auth, async (req, res) => {
    try {
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

// Get available rooms (vacant)
router.get('/available/:propertyId', auth, async (req, res) => {
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

module.exports = router;