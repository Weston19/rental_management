const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const router = express.Router();

// ========== TENANT AUTH ==========
// ========== TENANT SIGN UP (Phone Verification) ==========
router.post('/signup', async (req, res) => {
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
router.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    
    console.log('📡 Login attempt:', { phone, password: '****' });
    
    try {
        // Find tenant by phone number
        const result = await pool.query(`
            SELECT t.*, p.name as property_name, r.house_no, r.rent
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN properties p ON t.property_id = p.id
            WHERE t.phone = $1 AND t.is_deleted = FALSE
        `, [phone]);
        
        console.log('🔍 Tenant found:', result.rows.length > 0 ? '✅' : '❌');
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid phone number' });
        }
        
        const tenant = result.rows[0];
        console.log('👤 Tenant:', tenant.first_name, tenant.last_name);
        
        // Check if password exists
        if (!tenant.password_hash) {
            return res.status(401).json({ error: 'Account not set up. Please sign up first.' });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, tenant.password_hash);
        console.log('🔐 Password valid:', validPassword ? '✅' : '❌');
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        // Update last login
        await pool.query('UPDATE tenants SET last_login = NOW() WHERE id = $1', [tenant.id]);
        
        // Generate token
        const token = jwt.sign(
            { tenantId: tenant.id, phone: tenant.phone },
            process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET,
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

router.get('/dashboard/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    
    try {
        const tenant = await pool.query(`
            SELECT t.*, p.name as property_name, r.house_no, r.rent
            FROM tenants t
            LEFT JOIN properties p ON t.property_id = p.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.id = $1
        `, [tenantId]);
        
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
router.get('/invoices/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    
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
router.get('/payments/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    
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
router.put('/change-password/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const { current_password, new_password } = req.body;
    
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
        
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update phone number
router.put('/update-phone/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
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

// ========== INITIATE M-PESA PAYMENT ==========

router.post('/pay', async (req, res) => {
    const { tenant_id, amount, payment_type, phone_number } = req.body;
    
    try {
        const tenant = await pool.query('SELECT * FROM tenants WHERE id = $1', [tenant_id]);
        if (tenant.rows.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        // Generate checkout request ID
        const checkoutRequestID = 'CHECKOUT_' + Date.now() + '_' + tenant_id;
        
        // Store payment request in a temporary table (or memory)
        // For now, we'll simulate the response
        
        res.json({
            success: true,
            message: 'STK Push sent successfully',
            checkout_request_id: checkoutRequestID,
            phone_number: phone_number,
            amount: amount,
            payment_type: payment_type
        });
    } catch (error) {
        console.error('Payment initiation error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;