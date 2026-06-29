const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Sign up
router.post('/signup', async (req, res) => {
    const { email, password, company_name } = req.body;
    
    try {
        console.log('📝 Signup attempt:', { email, company_name });
        
        const existing = await pool.query('SELECT * FROM admin WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO admin (email, password_hash, company_name) VALUES ($1, $2, $3) RETURNING id, email, company_name',
            [email, hashedPassword, company_name]
        );
        
        const token = jwt.sign({ adminId: result.rows[0].id }, process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET);
        
        res.json({ token, admin: result.rows[0] });
    } catch (error) {
        console.error('❌ Signup error:', error.message);
        console.error('❌ Error stack:', error.stack);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await pool.query('SELECT * FROM admin WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const admin = result.rows[0];
        const validPassword = await bcrypt.compare(password, admin.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ adminId: admin.id }, process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET);
        res.json({ token, admin: { id: admin.id, email: admin.email, company_name: admin.company_name } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change Password
router.put('/change-password', auth, async (req, res) => {
    const { old_password, new_password } = req.body;
    
    try {
        const admin = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        const validPassword = await bcrypt.compare(old_password, admin.rows[0].password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE admin SET password_hash = $1 WHERE id = $2', [hashedPassword, req.adminId]);
        
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update Company Name
router.put('/update-company', auth, async (req, res) => {
    const { company_name } = req.body;
    
    try {
        await pool.query('UPDATE admin SET company_name = $1 WHERE id = $2', [company_name, req.adminId]);
        res.json({ message: 'Company name updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;