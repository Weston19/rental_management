const express = require('express');
const pool = require('../utils/db');
const auth = require('../middleware/auth');

const router = express.Router();

router.use(auth);

// Get all notifications for admin (paginated)
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const [notifRes, countRes] = await Promise.all([
            pool.query(
                `SELECT * FROM admin_notifications 
                 WHERE owner_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT $2 OFFSET $3`,
                [req.ownerId, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*) FROM admin_notifications WHERE owner_id = $1`,
                [req.ownerId]
            )
        ]);

        res.json({
            notifications: notifRes.rows,
            total: parseInt(countRes.rows[0].count),
            limit,
            offset
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get unread count
router.get('/unread-count', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) FROM admin_notifications WHERE owner_id = $1 AND is_read = FALSE',
            [req.ownerId]
        );
        res.json({ unreadCount: parseInt(result.rows[0].count) });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark notification as read
router.put('/:id/read', async (req, res) => {
    try {
        // Verify ownership
        const checkRes = await pool.query(
            'SELECT id FROM admin_notifications WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (checkRes.rows.length === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        await pool.query(
            'UPDATE admin_notifications SET is_read = TRUE WHERE id = $1',
            [req.params.id]
        );
        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark all as read
router.put('/mark-all-read', async (req, res) => {
    try {
        await pool.query(
            'UPDATE admin_notifications SET is_read = TRUE WHERE owner_id = $1',
            [req.ownerId]
        );
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete notification
router.delete('/:id', async (req, res) => {
    try {
        // Verify ownership
        const checkRes = await pool.query(
            'SELECT id FROM admin_notifications WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (checkRes.rows.length === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        await pool.query('DELETE FROM admin_notifications WHERE id = $1', [req.params.id]);
        res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
