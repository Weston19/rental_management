const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const { blockViewerWrites } = require('../middleware/requireRole');

const router = express.Router();

router.use(auth, blockViewerWrites);

// GET all sent messages — scoped to owner
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, a.email AS sender_email
            FROM messages m
            LEFT JOIN admin a ON m.sender_id = a.id
            WHERE m.owner_id = $1
            ORDER BY m.created_at DESC
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET single message — ownership enforced
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, a.email AS sender_email
            FROM messages m
            LEFT JOIN admin a ON m.sender_id = a.id
            WHERE m.id = $1 AND m.owner_id = $2
        `, [req.params.id, req.ownerId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST send message — only to this owner's tenants
router.post('/send', async (req, res) => {
    const { recipient_type, recipient_id, subject, message, template_id } = req.body;

    try {
        let recipients = [];

        if (recipient_type === 'all') {
            const r = await pool.query(
                'SELECT id, phone, first_name, last_name FROM tenants WHERE owner_id = $1 AND is_deleted = FALSE',
                [req.ownerId]
            );
            recipients = r.rows;
        } else if (recipient_type === 'property') {
            // Verify property belongs to this owner
            const prop = await pool.query(
                'SELECT id FROM properties WHERE id = $1 AND owner_id = $2',
                [recipient_id, req.ownerId]
            );
            if (prop.rows.length === 0) return res.status(404).json({ error: 'Property not found' });

            const r = await pool.query(
                'SELECT id, phone, first_name, last_name FROM tenants WHERE property_id = $1 AND owner_id = $2 AND is_deleted = FALSE',
                [recipient_id, req.ownerId]
            );
            recipients = r.rows;
        } else if (recipient_type === 'tenant') {
            const r = await pool.query(
                'SELECT id, phone, first_name, last_name FROM tenants WHERE id = $1 AND owner_id = $2 AND is_deleted = FALSE',
                [recipient_id, req.ownerId]
            );
            recipients = r.rows;
        } else if (recipient_type === 'arrears') {
            const r = await pool.query(`
                SELECT DISTINCT t.id, t.phone, t.first_name, t.last_name
                FROM tenants t
                JOIN bills b ON t.id = b.tenant_id
                WHERE t.owner_id = $1 AND t.is_deleted = FALSE AND b.total_bill > b.total_paid
            `, [req.ownerId]);
            recipients = r.rows;
        }

        if (recipients.length === 0) return res.status(400).json({ error: 'No recipients found' });

        const msgResult = await pool.query(
            `INSERT INTO messages
                (sender_id, recipient_type, recipient_id, template_used, subject, message, status, created_by, owner_id)
             VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,$8) RETURNING *`,
            [req.adminId, recipient_type, recipient_id, template_id, subject, message, req.adminId, req.ownerId]
        );

        const messageId = msgResult.rows[0].id;
        for (const recipient of recipients) {
            await pool.query(
                `INSERT INTO message_recipients (message_id, tenant_id, phone, status, sent_at)
                 VALUES ($1,$2,$3,'sent',NOW())`,
                [messageId, recipient.id, recipient.phone]
            );
        }

        res.json({ message: `Message sent to ${recipients.length} recipients`, messageId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST save draft
router.post('/draft', async (req, res) => {
    const { recipient_type, recipient_id, subject, message } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO messages
                (sender_id, recipient_type, recipient_id, subject, message, status, created_by, owner_id)
             VALUES ($1,$2,$3,$4,$5,'unsent',$6,$7) RETURNING *`,
            [req.adminId, recipient_type, recipient_id, subject, message, req.adminId, req.ownerId]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST resend message — ownership enforced
router.post('/resend/:id', async (req, res) => {
    try {
        const msg = await pool.query(
            'SELECT id FROM messages WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (msg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

        await pool.query("UPDATE messages          SET status = 'sent', sent_at = NOW() WHERE id = $1", [req.params.id]);
        await pool.query("UPDATE message_recipients SET status = 'sent', sent_at = NOW() WHERE message_id = $1", [req.params.id]);
        res.json({ message: 'Message resent successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE message — ownership enforced
router.delete('/:id', async (req, res) => {
    try {
        const msg = await pool.query(
            'SELECT id FROM messages WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (msg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
        res.json({ message: 'Message deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET inbox — scoped to this owner's tenants
router.get('/inbox', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, t.first_name, t.last_name, t.phone
            FROM inbox i
            LEFT JOIN tenants t ON i.tenant_id = t.id
            WHERE t.owner_id = $1
            ORDER BY i.created_at DESC
        `, [req.ownerId]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT mark inbox message as read — scoped via tenant ownership
router.put('/inbox/:id/read', async (req, res) => {
    try {
        const check = await pool.query(`
            SELECT i.id FROM inbox i
            JOIN tenants t ON i.tenant_id = t.id
            WHERE i.id = $1 AND t.owner_id = $2
        `, [req.params.id, req.ownerId]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

        await pool.query('UPDATE inbox SET is_read = TRUE WHERE id = $1', [req.params.id]);
        res.json({ message: 'Message marked as read' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
