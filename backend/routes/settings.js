const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcrypt');
const redis = require('../redis');
const { blockViewerWrites, requireOwner } = require('../middleware/requireRole');

const router = express.Router();

router.use(auth, blockViewerWrites);

// GET current admin/company info
router.get('/admin', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, company_name, created_at FROM admin WHERE id = $1',
            [req.ownerId]   // always return the owner's company info
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });

        // Also return the current user's role
        res.json({ ...result.rows[0], role: req.role });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update company name — owner only
router.put('/update-company', requireOwner, async (req, res) => {
    const { company_name } = req.body;
    if (!company_name || company_name.trim() === '') {
        return res.status(400).json({ error: 'Company name is required' });
    }
    try {
        const result = await pool.query(
            'UPDATE admin SET company_name = $1 WHERE id = $2 RETURNING id, email, company_name',
            [company_name.trim(), req.adminId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });
        // Sync role name
        await pool.query(
            'UPDATE admin_roles SET name = $1 WHERE admin_id = $2 AND owner_id = $2',
            [company_name.trim(), req.adminId]
        );
        await redis.del(`all_properties:${req.ownerId}`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT change password — any role (changes own password only)
router.put('/change-password', async (req, res) => {
    const { old_password, new_password } = req.body;
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!old_password || !new_password) {
        return res.status(400).json({ error: 'Old and new passwords are required' });
    }
    if (new_password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    try {
        const result = await pool.query(
            'SELECT password_hash FROM admin WHERE id = $1',
            [req.adminId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });

        const match = await bcrypt.compare(old_password, result.rows[0].password_hash);
        if (!match) return res.status(400).json({ error: 'Current password is incorrect' });

        const hashed = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE admin SET password_hash = $1 WHERE id = $2', [hashed, req.adminId]);

        // Blacklist the current token — force re-login
        if (token) {
            await redis.setex(`blacklist:${token}`, 28800, 'true');
        }

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SMS TEMPLATES — scoped to owner
// ─────────────────────────────────────────────────────────────────────────────

// GET all templates for this owner
router.get('/templates', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sms_templates WHERE owner_id = $1 ORDER BY name',
            [req.ownerId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET single template — ownership enforced
router.get('/templates/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sms_templates WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST add template — manager+
router.post('/templates', async (req, res) => {
    const { name, template_text, description } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO sms_templates (name, template_text, description, owner_id) VALUES ($1,$2,$3,$4) RETURNING *',
            [name, template_text, description, req.ownerId]
        );
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'Template name already exists' });
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update template — manager+, ownership enforced
router.put('/templates/:id', async (req, res) => {
    const { name, template_text, description } = req.body;
    try {
        const result = await pool.query(
            `UPDATE sms_templates
             SET name = $1, template_text = $2, description = $3, updated_at = NOW()
             WHERE id = $4 AND owner_id = $5 RETURNING *`,
            [name, template_text, description, req.params.id, req.ownerId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE template — owner only
router.delete('/templates/:id', requireOwner, async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT id FROM sms_templates WHERE id = $1 AND owner_id = $2',
            [req.params.id, req.ownerId]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        await pool.query('DELETE FROM sms_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST reset templates to defaults — owner only
router.post('/templates/reset', requireOwner, async (req, res) => {
    try {
        await pool.query('DELETE FROM sms_templates WHERE owner_id = $1', [req.ownerId]);
        await pool.query(`
            INSERT INTO sms_templates (name, template_text, description, owner_id) VALUES
            ('bill_creation',        'Hello {name}, your {month} bill for {item} is KES {amount}, previous balance KES {balance}, total bill KES {total}. Due date is {due_date}.',                                                                                                                         'Sent when a bill is created',    $1),
            ('penalty_notification', 'Hello {name}, this is a reminder that your rent was overdue on {due_date}. A late payment penalty of KES {penalty} has been awarded. Total balance is now KES {total}. Payment instructions: Rent: {room_no}, Penalty: P{room_no}, Deposit: D{room_no}.', 'Sent when penalty is awarded',   $1),
            ('rent_reminder',        'Hello {name}, this is to remind you that your rent payment of {month} amount {balance} is due on {due_date}. Please make payment on time to avoid penalties.',                                                                                                         'Sent as a reminder',             $1),
            ('payment_receipt',      'Hello {name}, we have received your payment of KES {amount} for {payment_type} on {date}. Your current balance is KES {balance}. Thank you for your payment.',                                                                                                         'Sent when payment is recorded',  $1)
        `, [req.ownerId]);
        res.json({ message: 'Templates reset to defaults' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET SMS balance placeholder
router.get('/sms-balance', async (req, res) => {
    res.json({ balance: '1500.50' });
});

module.exports = router;
