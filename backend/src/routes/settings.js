const express = require('express');
const pool = require('../utils/db');
const auth = require('../middleware/auth');
const bcrypt = require('bcrypt');
const redis = require('../utils/redis');
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

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT SETUP — scoped to owner
// ─────────────────────────────────────────────────────────────────────────────

// GET list of Kenyan banks and mobile money providers
router.get('/payment-providers', async (req, res) => {
    try {
        // Check Redis cache first
        const cacheKey = 'payment_providers:ke';
        const cachedProviders = await redis.get(cacheKey);
        
        if (cachedProviders) {
            console.log('Using cached payment providers');
            return res.json(JSON.parse(cachedProviders));
        }
        
        const paystackCircuit = require('../circuits/paystack-circuit');
        let banksResult;
        let kenyanBanks = [];
        try {
            banksResult = await paystackCircuit.listBanks('ke');
            console.log('Paystack banks result:', JSON.stringify(banksResult, null, 2));
            if (banksResult && banksResult.data && Array.isArray(banksResult.data)) {
                kenyanBanks = banksResult.data.map(bank => ({
                    code: bank.code,
                    name: bank.name
                }));
            }
        } catch (e) {
            console.error('Error fetching banks from Paystack:', e);
        }
        
        // Fallback to common Kenyan banks if Paystack returns nothing
        if (kenyanBanks.length === 0) {
            kenyanBanks = [
                { code: '011', name: 'Equity Bank Kenya' },
                { code: '001', name: 'KCB Bank Kenya' },
                { code: '002', name: 'Co-operative Bank of Kenya' },
                { code: '003', name: 'NCBA Bank Kenya' },
                { code: '004', name: 'Absa Bank Kenya' },
                { code: '005', name: 'Standard Chartered Bank Kenya' },
                { code: '006', name: 'DTB Bank Kenya' },
                { code: '007', name: 'I&M Bank Kenya' },
                { code: '008', name: 'Sidian Bank' },
                { code: '009', name: 'Family Bank Kenya' },
                { code: '010', name: 'Safaricom M-Pesa' },
                { code: '012', name: 'Kenya Women Microfinance Bank' },
                { code: '013', name: 'Postbank Kenya' },
                { code: '014', name: 'Housing Finance Company Kenya' },
                { code: '015', name: 'Kenya Commercial Bank' },
                { code: '016', name: 'Chase Bank Kenya' },
                { code: '017', name: 'Barclays Bank of Kenya' },
                { code: '018', name: 'CFC Stanbic Bank' },
                { code: '019', name: 'NIC Bank Kenya' },
                { code: '020', name: 'Bank of India Kenya' },
                { code: '021', name: 'Bank of Baroda Kenya' },
                { code: '022', name: 'Citibank Kenya' },
                { code: '023', name: 'Ecobank Kenya' },
                { code: '024', name: 'Guaranty Trust Bank Kenya' },
                { code: '025', name: 'Habib Bank Kenya' },
                { code: '026', name: 'Mashreq Bank Kenya' },
                { code: '027', name: 'Middle East Bank Kenya' },
                { code: '028', name: 'Prime Bank Kenya' },
                { code: '029', name: 'Standard Bank Kenya' },
                { code: '030', name: 'Victoria Commercial Bank Kenya' }
            ];
        }
        
        // Kenyan mobile money providers (common ones supported by Paystack)
        const mobileMoneyProviders = [
            { code: 'MPESA', name: 'M-PESA' },
            { code: 'MPESA_PAYBILL', name: 'M-PESA Paybill' },
            { code: 'MPESA_TILL', name: 'M-PESA Till' },
            { code: 'AIRTEL', name: 'Airtel Kenya' },
            { code: 'TELKOM', name: 'Telkom Kenya' }
        ];
        
        const providers = {
            banks: kenyanBanks,
            mobileMoney: mobileMoneyProviders
        };
        
        // Cache the result for 24 hours (86400 seconds)
        await redis.setex(cacheKey, 86400, JSON.stringify(providers));
        
        res.json(providers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET payment setup info
router.get('/payment-setup', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT currency, payment_type, provider_code, provider_name, account_number, account_name, payment_configured, company_name FROM admin WHERE id = $1',
            [req.ownerId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT update payment setup — owner only
router.put('/payment-setup', requireOwner, async (req, res) => {
    const { currency, payment_type, provider_code, provider_name, account_number, account_name } = req.body;
    
    if (!currency || !payment_type || !provider_code || !provider_name || !account_number || !account_name) {
        return res.status(400).json({ error: 'All payment fields are required' });
    }
    
    try {
        // Update admin table - no subaccount creation anymore
        const updateResult = await pool.query(
            `UPDATE admin 
             SET currency = $1, 
                 payment_type = $2, 
                 provider_code = $3, 
                 provider_name = $4, 
                 account_number = $5, 
                 account_name = $6, 
                 payment_configured = TRUE 
             WHERE id = $7 
             RETURNING currency, payment_type, provider_code, provider_name, account_number, account_name, payment_configured`,
            [currency, payment_type, provider_code, provider_name, account_number, account_name, req.ownerId]
        );
        
        res.json(updateResult.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// GET SMS balance placeholder
router.get('/sms-balance', async (req, res) => {
    res.json({ balance: '1500.50' });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

// Get notification preferences
router.get('/notification-preferences', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT notify_on_payment, notify_channel, notify_on_arrears FROM admin WHERE id = $1',
            [req.ownerId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get notification preferences error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update notification preferences
router.put('/notification-preferences', requireOwner, async (req, res) => {
    const { notify_on_payment, notify_channel, notify_on_arrears } = req.body;
    try {
        const result = await pool.query(
            `UPDATE admin 
             SET notify_on_payment = $1, 
                 notify_channel = $2, 
                 notify_on_arrears = $3 
             WHERE id = $4 
             RETURNING notify_on_payment, notify_channel, notify_on_arrears`,
            [notify_on_payment, notify_channel, notify_on_arrears, req.ownerId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update notification preferences error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
