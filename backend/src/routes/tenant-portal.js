const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../utils/db');
const tenantAuth = require('../middleware/tenant-auth');
const redis = require('../utils/redis');
const loginRateLimiter = require('../middleware/rateLimit');
const { validateTenantSignup, validateTenantLogin, validatePayment } = require('../middleware/validateInput');
const { stkPushCircuit, stkQueryCircuit } = require('../circuits/mpesa-circuit');
const router = express.Router();

// ================================================================
// PHONE NUMBER NORMALIZATION
// ================================================================
function normalizeKenyanPhone(raw) {
    let phone = String(raw).replace(/\D/g, '');
    if (phone.startsWith('0') && phone.length === 10) {
        phone = '254' + phone.slice(1);
    } else if (phone.startsWith('7') && phone.length === 9) {
        phone = '254' + phone;
    } else if (phone.startsWith('1') && phone.length === 9) {
        phone = '254' + phone;
    } else if (phone.startsWith('+254')) {
        phone = phone.slice(1); // remove +
    }
    if (!phone.startsWith('254') || phone.length !== 12) {
        throw new Error('Invalid Kenyan phone number. Use format: 07XXXXXXXX, 2547XXXXXXXX, or +2547XXXXXXXX');
    }
    return phone;
}

// ========== TENANT AUTH ==========
// ========== TENANT SIGN UP (Phone Verification) ==========
router.post('/signup', loginRateLimiter, validateTenantSignup, async (req, res) => {
    const { phone, password } = req.body;
    
    try {
        // Check if phone exists in tenants table
        const tenant = await pool.query(
            'SELECT id, first_name, last_name FROM tenants WHERE phone = $1 AND is_deleted = FALSE',
            [phone]
        );
        
        if (tenant.rows.length === 0) {
            return res.status(400).json({ 
                error: 'Phone number not found. Please contact your landlord to register you as a tenant.'
            });
        }
        
        // Check if tenant already has a password
        const hasPassword = await pool.query(
            'SELECT password_hash FROM tenants WHERE id = $1',
            [tenant.rows[0].id]
        );
        
        if (hasPassword.rows[0].password_hash) {
            return res.status(400).json({ 
                error: 'Account already set up. Please login.'
            });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Update tenant with password
        await pool.query(
            'UPDATE tenants SET password_hash = $1, portal_enabled = TRUE WHERE id = $2',
            [hashedPassword, tenant.rows[0].id]
        );
        
        res.json({
            success: true,
            message: 'Account created successfully! Please login.',
            tenant: {
                id: tenant.rows[0].id,
                first_name: tenant.rows[0].first_name,
                last_name: tenant.rows[0].last_name
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== TENANT LOGIN (Phone + Password) ==========
router.post('/login', loginRateLimiter, validateTenantLogin, async (req, res) => {
    const { phone, password } = req.body;
    
    try {
        // Find tenant by phone number
        const result = await pool.query(`
            SELECT t.*, p.name as property_name, r.house_no, r.rent
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN properties p ON t.property_id = p.id
            WHERE t.phone = $1 AND t.is_deleted = FALSE
        `, [phone]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid phone number' });
        }
        
        const tenant = result.rows[0];
        
        // Check if password exists
        if (!tenant.password_hash) {
            return res.status(401).json({ error: 'Account not set up. Please sign up first.' });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, tenant.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        // Update last login
        await pool.query('UPDATE tenants SET last_login = NOW() WHERE id = $1', [tenant.id]);
        
        // Generate token
        const secret = process.env.JWT_SECRET || process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET;
        if (!secret) {
            return res.status(500).json({ error: 'JWT_SECRET environment variable is missing' });
        }
        const token = jwt.sign(
            { tenantId: tenant.id, phone: tenant.phone },
            secret,
            { expiresIn: '7d' }
        );
        
        // Get balance
        const balanceResult = await pool.query(
            'SELECT COALESCE(SUM(total_bill - total_paid), 0) as balance FROM bills WHERE tenant_id = $1',
            [tenant.id]
        );
        
        const billedResult = await pool.query(
            'SELECT COALESCE(SUM(total_bill), 0) as total_billed FROM bills WHERE tenant_id = $1',
            [tenant.id]
        );
        
        const paidResult = await pool.query(
            'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE tenant_id = $1',
            [tenant.id]
        );
        
        const lastPayment = await pool.query(`
            SELECT amount, payment_date FROM payments 
            WHERE tenant_id = $1 
            ORDER BY payment_date DESC 
            LIMIT 1
        `, [tenant.id]);
        
        res.json({
            token,
            tenant: {
                id: tenant.id,
                first_name: tenant.first_name,
                last_name: tenant.last_name,
                phone: tenant.phone,
                email: tenant.email || '',
                house_no: tenant.house_no,
                property_name: tenant.property_name,
                rent: tenant.rent,
                national_id: tenant.national_id,
                move_in_date: tenant.move_in_date,
                balance: parseFloat(balanceResult.rows[0].balance) || 0,
                total_billed: parseFloat(billedResult.rows[0].total_billed) || 0,
                total_paid: parseFloat(paidResult.rows[0].total_paid) || 0,
                last_payment: lastPayment.rows[0] || null
            }
        });
    } catch (error) {
        console.error('Tenant login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== TENANT DASHBOARD ==========

router.get('/dashboard/:tenantId', tenantAuth, async (req, res) => {
    const { tenantId } = req.params;

    try {
        const tenant = await pool.query(`
            SELECT t.*, p.name as property_name, r.house_no, r.rent
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.id = $1 AND t.id = $2
        `, [tenantId, req.tenantId]);

        if (tenant.rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        const balanceResult = await pool.query(
            'SELECT COALESCE(SUM(total_bill - total_paid), 0) as balance FROM bills WHERE tenant_id = $1',
            [tenantId]
        );
        
        const billedResult = await pool.query(
            'SELECT COALESCE(SUM(total_bill), 0) as total_billed FROM bills WHERE tenant_id = $1',
            [tenantId]
        );
        
        const paidResult = await pool.query(
            'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE tenant_id = $1',
            [tenantId]
        );
        
        const payments = await pool.query(`
            SELECT * FROM payments 
            WHERE tenant_id = $1 
            ORDER BY payment_date DESC 
            LIMIT 10
        `, [tenantId]);
        
        const invoices = await pool.query(`
            SELECT b.*, 
                   (SELECT json_agg(json_build_object('item_name', bi.item_name, 'amount', bi.amount))
                    FROM bill_items bi WHERE bi.bill_id = b.id) as items
            FROM bills b
            WHERE b.tenant_id = $1
            ORDER BY b.bill_month DESC
            LIMIT 10
        `, [tenantId]);
        
        res.json({
            tenant: tenant.rows[0],
            balance: parseFloat(balanceResult.rows[0].balance) || 0,
            total_billed: parseFloat(billedResult.rows[0].total_billed) || 0,
            total_paid: parseFloat(paidResult.rows[0].total_paid) || 0,
            payments: payments.rows,
            invoices: invoices.rows
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== TENANT PAYMENTS ==========

// Get all invoices
router.get('/invoices/:tenantId', tenantAuth, async (req, res) => {
    const { tenantId } = req.params;

    // Tenants can only access their own invoices
    if (parseInt(tenantId) !== req.tenantId) {
        return res.status(403).json({ error: 'Access forbidden.' });
    }

    try {
        const result = await pool.query(`
            SELECT b.*, 
                   (SELECT json_agg(json_build_object('item_name', bi.item_name, 'amount', bi.amount))
                    FROM bill_items bi WHERE bi.bill_id = b.id) as items
            FROM bills b
            WHERE b.tenant_id = $1
            ORDER BY b.bill_month DESC
        `, [tenantId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Invoices error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get payment history
router.get('/payments/:tenantId', tenantAuth, async (req, res) => {
    const { tenantId } = req.params;

    if (parseInt(tenantId) !== req.tenantId) {
        return res.status(403).json({ error: 'Access forbidden.' });
    }

    try {
        const result = await pool.query(`
            SELECT * FROM payments 
            WHERE tenant_id = $1 
            ORDER BY payment_date DESC
        `, [tenantId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Payment history error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== TENANT PROFILE ==========

// Change password
router.put('/change-password/:tenantId', tenantAuth, async (req, res) => {
    const { tenantId } = req.params;

    if (parseInt(tenantId) !== req.tenantId) {
        return res.status(403).json({ error: 'Access forbidden.' });
    }

    const { current_password, new_password } = req.body;
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    try {
        const tenant = await pool.query('SELECT password_hash FROM tenants WHERE id = $1', [tenantId]);
        if (tenant.rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        const validPassword = await bcrypt.compare(current_password, tenant.rows[0].password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await pool.query(
            'UPDATE tenants SET password_hash = $1 WHERE id = $2',
            [hashedPassword, tenantId]
        );

        // Blacklist old token
        if (token) {
            await redis.setex(`blacklist:${token}`, 604800, 'true'); // 7 days
        }
        
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Tenant Logout
router.post('/logout', tenantAuth, async (req, res) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    try {
        if (token) {
            // Blacklist token for 7 days (tenant token expiration)
            await redis.setex(`blacklist:${token}`, 604800, 'true');
        }
        
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update phone number
router.put('/update-phone/:tenantId', tenantAuth, async (req, res) => {
    const { tenantId } = req.params;

    if (parseInt(tenantId) !== req.tenantId) {
        return res.status(403).json({ error: 'Access forbidden.' });
    }

    const { phone } = req.body;
    
    try {
        await pool.query(
            'UPDATE tenants SET phone = $1 WHERE id = $2',
            [phone, tenantId]
        );
        res.json({ message: 'Phone number updated successfully' });
    } catch (error) {
        console.error('Update phone error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========== INITIATE PAYMENT (Paystack) ==========
const { initializeTransaction } = require('../circuits/paystack-circuit');
const crypto = require('crypto');

router.post('/pay', tenantAuth, validatePayment, async (req, res) => {
    const { amount, phone_number, payment_type, email } = req.body;
    const tenantId = req.tenantId;
    
    try {
        const tenantRes = await pool.query(
            `SELECT t.*, 
                    a.payment_configured, a.paystack_subaccount_code, 
                    a.currency, a.payment_type AS admin_payment_type 
             FROM tenants t 
             JOIN admin a ON t.owner_id = a.id 
             WHERE t.id = $1`,
            [tenantId]
        );
        
        if (tenantRes.rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        const tenant = tenantRes.rows[0];
        
        if (!tenant.payment_configured) {
            return res.status(400).json({ error: 'Agency payment not configured' });
        }
        
        // Generate unique reference with all server-known IDs
        const cryptoRandom = crypto.randomUUID();
        const reference = `rent_${tenant.owner_id}_${tenantId}_${cryptoRandom}`;
        
        // Format phone number for Paystack
        let formattedPhone = phone_number.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.slice(1);
        } else if (!formattedPhone.startsWith('254')) {
            formattedPhone = '254' + formattedPhone;
        }
        
        // Use Paystack's transaction initialize for STK Push
        const result = await initializeTransaction({
            email: email || tenant.email || 'tenant@example.com',
            amount: amount,
            reference: reference,
            subaccount_code: tenant.paystack_subaccount_code,
            metadata: {
                tenant_id: tenantId,
                owner_id: tenant.owner_id,
                payment_type: payment_type,
                phone_number: formattedPhone
            }
        });
        
        res.json({
            success: true,
            message: 'STK Push initiated successfully',
            authorization_url: result.data.authorization_url,
            access_code: result.data.access_code,
            reference: result.data.reference
        });
    } catch (error) {
        console.error('Payment initiation error:', error);
        res.status(500).json({ 
            error: error.response?.data?.message || 'Server error' 
        });
    }
});

// ================================================================
// TENANT STK PUSH  (M-Pesa, tenant-authenticated)
// ================================================================

// POST /api/tenant-portal/mpesa/stkpush
router.post('/mpesa/stkpush', tenantAuth, async (req, res) => {
    const { phone_number, amount, payment_type } = req.body;
    const tenantId = req.tenantId;

    // --- Validate inputs ---
    if (!phone_number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'A valid amount is required' });
    }

    let formattedPhone;
    try {
        formattedPhone = normalizeKenyanPhone(phone_number);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const amountInt = Math.round(parseFloat(amount));

    // --- Build account reference from payment type prefix ---
    let accountRef;
    try {
        const tenantRes = await pool.query(
            'SELECT account_number, house_no FROM tenants WHERE id = $1',
            [tenantId]
        );
        const houseNo = tenantRes.rows[0]?.account_number || tenantRes.rows[0]?.house_no || String(tenantId);
        const prefix = payment_type === 'deposit' ? 'D' : payment_type === 'penalty' ? 'P' : '';
        accountRef = prefix + houseNo;
    } catch {
        accountRef = 'RENTPAY';
    }

    // --- Check if M-Pesa credentials are set ---
    const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
    const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
    const SHORTCODE = process.env.MPESA_SHORTCODE;
    const PASSKEY = process.env.MPESA_PASSKEY;
    const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;

    if (!CONSUMER_KEY || !CONSUMER_SECRET || !SHORTCODE || !PASSKEY || !CALLBACK_URL) {
        // Demo / sandbox fallback
        const mockCheckoutId = 'SIM_' + Date.now();
        await pool.query(
            `INSERT INTO payment_requests (checkout_request_id, amount, phone_number, status, created_at)
             VALUES ($1, $2, $3, 'pending', NOW())`,
            [mockCheckoutId, amountInt, formattedPhone]
        );
        return res.json({
            success: true,
            demo: true,
            checkout_request_id: mockCheckoutId,
            message: 'Demo mode: STK Push simulated (M-Pesa not configured)',
            phone: formattedPhone
        });
    }

    try {
        if (stkPushCircuit.opened) {
            return res.status(503).json({
                success: false,
                error: 'M-Pesa service temporarily unavailable. Please try again in 1 minute.'
            });
        }

        const response = await stkPushCircuit.fire(
            formattedPhone,
            amountInt,
            accountRef,
            `${payment_type || 'rent'} payment`
        );

        if (response.CheckoutRequestID) {
            await pool.query(
                `INSERT INTO payment_requests (checkout_request_id, amount, phone_number, status, created_at)
                 VALUES ($1, $2, $3, 'pending', NOW())
                 ON CONFLICT (checkout_request_id) DO NOTHING`,
                [response.CheckoutRequestID, amountInt, formattedPhone]
            );
        }

        res.json({
            success: true,
            checkout_request_id: response.CheckoutRequestID,
            merchant_request_id: response.MerchantRequestID,
            phone: formattedPhone,
            message: 'STK Push sent. Check your phone for the M-Pesa prompt.'
        });
    } catch (error) {
        console.error('❌ Tenant STK Push Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.errorMessage || error.message || 'Failed to initiate STK Push'
        });
    }
});

// POST /api/tenant-portal/mpesa/stkquery  – poll payment status
router.post('/mpesa/stkquery', tenantAuth, async (req, res) => {
    const { checkout_request_id } = req.body;

    if (!checkout_request_id) {
        return res.status(400).json({ error: 'checkout_request_id is required' });
    }

    // Handle demo / simulated requests
    if (String(checkout_request_id).startsWith('SIM_')) {
        const row = await pool.query(
            'SELECT status FROM payment_requests WHERE checkout_request_id = $1',
            [checkout_request_id]
        );
        const status = row.rows[0]?.status || 'pending';
        return res.json({ success: true, status, demo: true });
    }

    // Check local DB first (callback may have already arrived)
    try {
        const local = await pool.query(
            'SELECT status FROM payment_requests WHERE checkout_request_id = $1',
            [checkout_request_id]
        );
        if (local.rows.length > 0 && local.rows[0].status !== 'pending') {
            return res.json({ success: true, status: local.rows[0].status });
        }
    } catch { /* fall through to live query */ }

    // Check M-Pesa credentials
    const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
    const SHORTCODE = process.env.MPESA_SHORTCODE;
    if (!CONSUMER_KEY || !SHORTCODE) {
        // No credentials → just return pending
        return res.json({ success: true, status: 'pending' });
    }

    try {
        const queryResult = await stkQueryCircuit.fire(checkout_request_id);
        // ResultCode 0 = success, 1032 = cancelled, others = failed/pending
        const rc = parseInt(queryResult.ResultCode ?? queryResult.resultCode ?? -1);
        let status = 'pending';
        if (rc === 0) status = 'completed';
        else if (rc === 1032) status = 'cancelled';
        else if (rc !== -1) status = 'failed';

        if (status !== 'pending') {
            await pool.query(
                'UPDATE payment_requests SET status = $1 WHERE checkout_request_id = $2',
                [status, checkout_request_id]
            );
        }

        res.json({ success: true, status, result_code: rc, result_desc: queryResult.ResultDesc });
    } catch (error) {
        // If the query itself fails, return pending so the timer can keep trying
        res.json({ success: true, status: 'pending', note: 'Query inconclusive, keep polling' });
    }
});

module.exports = router;