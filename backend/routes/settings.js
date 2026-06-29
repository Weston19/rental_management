const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcrypt');

const router = express.Router();

// Get current admin/company info
router.get('/admin', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, email, company_name, created_at FROM admin WHERE id = $1', [req.adminId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update company name
router.put('/update-company', auth, async (req, res) => {
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
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change password
router.put('/change-password', auth, async (req, res) => {
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
        return res.status(400).json({ error: 'Old and new passwords are required' });
    }
    if (new_password.length < 4) {
        return res.status(400).json({ error: 'New password must be at least 4 characters' });
    }

    try {
        const result = await pool.query('SELECT password FROM admin WHERE id = $1', [req.adminId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });

        const match = await bcrypt.compare(old_password, result.rows[0].password);
        if (!match) return res.status(400).json({ error: 'Current password is incorrect' });

        const hashed = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE admin SET password = $1 WHERE id = $2', [hashed, req.adminId]);

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// SMS TEMPLATES 

// Get all templates created by the admin 
router.get('/templates', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sms_templates ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single template
router.get('/templates/:id', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sms_templates WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add template
router.post('/templates', auth, async (req, res) => {
    const { name, template_text, description } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO sms_templates (name, template_text, description) VALUES ($1, $2, $3) RETURNING *',
            [name, template_text, description]
        );
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'Template name already exists' });
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update template
router.put('/templates/:id', auth, async (req, res) => {
    const { name, template_text, description } = req.body;
    try {
        const result = await pool.query(
            'UPDATE sms_templates SET name = $1, template_text = $2, description = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
            [name, template_text, description, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete template
router.delete('/templates/:id', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM sms_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Reset templates to defaults
router.post('/templates/reset', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM sms_templates');
        await pool.query(`
            INSERT INTO sms_templates (name, template_text, description) VALUES
            ('bill_creation', 'Hello {name}, your {month} bill for {item} is KES {amount}, previous balance KES {balance}, total bill KES {total}. Due date is {due_date}.', 'Sent when a bill is created'),
            ('penalty_notification', 'Hello {name}, this is a reminder that your rent was overdue on {due_date}. A late payment penalty of KES {penalty} has been awarded. Total balance is now KES {total}. Payment instructions: Rent: {room_no}, Penalty: P{room_no}, Deposit: D{room_no}.', 'Sent when penalty is awarded'),
            ('rent_reminder', 'Hello {name}, this is to remind you that your rent payment of {month} amount {balance} is due on {due_date}. Please make payment on time to avoid penalties.', 'Sent as a reminder'),
            ('payment_receipt', 'Hello {name}, we have received your payment of KES {amount} for {payment_type} on {date}. Your current balance is KES {balance}. Thank you for your payment.', 'Sent when payment is recorded')
        `);
        res.json({ message: 'Templates reset to defaults' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get SMS balance (Africa's Talking placeholder)
router.get('/sms-balance', auth, async (req, res) => {
    // Placeholder - returns a dummy balance until Africa's Talking is configured
    res.json({ balance: '1500.50' });
});

module.exports = router;