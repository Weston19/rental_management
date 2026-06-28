const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all messages
router.get('/', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, a.email as sender_email
            FROM messages m
            LEFT JOIN admin a ON m.sender_id = a.id
            ORDER BY m.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single message
router.get('/:id', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, a.email as sender_email
            FROM messages m
            LEFT JOIN admin a ON m.sender_id = a.id
            WHERE m.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send message
router.post('/send', auth, async (req, res) => {
    const { recipient_type, recipient_id, subject, message, template_id } = req.body;
    
    try {
        // Get all recipients based on type
        let recipients = [];
        if (recipient_type === 'all') {
            const result = await pool.query('SELECT id, phone, first_name, last_name FROM tenants WHERE is_deleted = FALSE');
            recipients = result.rows;
        } else if (recipient_type === 'property') {
            const result = await pool.query('SELECT id, phone, first_name, last_name FROM tenants WHERE property_id = $1 AND is_deleted = FALSE', [recipient_id]);
            recipients = result.rows;
        } else if (recipient_type === 'tenant') {
            const result = await pool.query('SELECT id, phone, first_name, last_name FROM tenants WHERE id = $1 AND is_deleted = FALSE', [recipient_id]);
            recipients = result.rows;
        } else if (recipient_type === 'arrears') {
            const result = await pool.query(`
                SELECT t.id, t.phone, t.first_name, t.last_name
                FROM tenants t
                JOIN bills b ON t.id = b.tenant_id
                WHERE t.is_deleted = FALSE AND b.total_bill > b.total_paid
                GROUP BY t.id
            `);
            recipients = result.rows;
        }
        
        if (recipients.length === 0) {
            return res.status(400).json({ error: 'No recipients found' });
        }
        
        // Create message record
        const msgResult = await pool.query(
            `INSERT INTO messages (sender_id, recipient_type, recipient_id, template_used, subject, message, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7) RETURNING *`,
            [req.adminId, recipient_type, recipient_id, template_id, subject, message, req.adminId]
        );
        
        const messageId = msgResult.rows[0].id;
        
        // Create recipient records
        for (const recipient of recipients) {
            await pool.query(
                `INSERT INTO message_recipients (message_id, tenant_id, phone, status, sent_at)
                 VALUES ($1, $2, $3, 'sent', NOW())`,
                [messageId, recipient.id, recipient.phone]
            );
        }
        
        res.json({ message: `Message sent to ${recipients.length} recipients`, messageId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Save draft
router.post('/draft', auth, async (req, res) => {
    const { recipient_type, recipient_id, subject, message } = req.body;
    
    try {
        const result = await pool.query(
            `INSERT INTO messages (sender_id, recipient_type, recipient_id, subject, message, status, created_by)
             VALUES ($1, $2, $3, $4, $5, 'unsent', $6) RETURNING *`,
            [req.adminId, recipient_type, recipient_id, subject, message, req.adminId]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Resend message
router.post('/resend/:id', auth, async (req, res) => {
    try {
        const message = await pool.query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
        if (message.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        
        await pool.query('UPDATE messages SET status = $1, sent_at = NOW() WHERE id = $2', ['sent', req.params.id]);
        await pool.query('UPDATE message_recipients SET status = $1, sent_at = NOW() WHERE message_id = $2', ['sent', req.params.id]);
        
        res.json({ message: 'Message resent successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete message
router.delete('/:id', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
        res.json({ message: 'Message deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Inbox - get incoming messages
router.get('/inbox', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, t.first_name, t.last_name, t.phone
            FROM inbox i
            LEFT JOIN tenants t ON i.tenant_id = t.id
            ORDER BY i.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Mark as read
router.put('/inbox/:id/read', auth, async (req, res) => {
    try {
        await pool.query('UPDATE inbox SET is_read = TRUE WHERE id = $1', [req.params.id]);
        res.json({ message: 'Message marked as read' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;