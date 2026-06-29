const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const auth = require('../middleware/auth');
const redis = require('../redis');
const loginRateLimiter = require('../middleware/rateLimit');
const { validateAdminSignup, validateAdminLogin } = require('../middleware/validateInput');
const { requireOwner } = require('../middleware/requireRole');

const router = express.Router();

// ─── Helper: sign a token with both adminId and ownerId ───────────────────────
function signToken(adminId, ownerId) {
    return jwt.sign(
        { adminId, ownerId },
        process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET,
        { expiresIn: '8h' }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER SIGN UP  (creates a new isolated account — always gets 'owner' role)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/signup', loginRateLimiter, validateAdminSignup, async (req, res) => {
    const { email, password, company_name } = req.body;

    try {
        const existing = await pool.query('SELECT id FROM admin WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            'INSERT INTO admin (email, password_hash, company_name) VALUES ($1, $2, $3) RETURNING id, email, company_name',
            [email, hashedPassword, company_name]
        );

        const newAdmin = result.rows[0];

        // Register the new admin as the owner of their own workspace
        await pool.query(
            `INSERT INTO admin_roles (admin_id, owner_id, email, name, role)
             VALUES ($1, $1, $2, $3, 'owner')
             ON CONFLICT (admin_id, owner_id) DO NOTHING`,
            [newAdmin.id, newAdmin.email, company_name]
        );

        const token = signToken(newAdmin.id, newAdmin.id);
        res.json({ token, admin: { ...newAdmin, role: 'owner' } });
    } catch (error) {
        console.error('Signup error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN  (works for both owners and invited managers/viewers)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', loginRateLimiter, validateAdminLogin, async (req, res) => {
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

        // Find their role row — a user may have roles under multiple owners;
        // for now we pick the one where they ARE the owner, falling back to first active.
        const roleResult = await pool.query(
            `SELECT owner_id, role FROM admin_roles
             WHERE admin_id = $1 AND is_active = TRUE
             ORDER BY (admin_id = owner_id) DESC, id ASC
             LIMIT 1`,
            [admin.id]
        );

        if (roleResult.rows.length === 0) {
            return res.status(403).json({ error: 'No active role found for this account.' });
        }

        const { owner_id, role } = roleResult.rows[0];
        const token = signToken(admin.id, owner_id);

        res.json({
            token,
            admin: {
                id: admin.id,
                email: admin.email,
                company_name: admin.company_name,
                role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    try {
        if (token) {
            await redis.setex(`blacklist:${token}`, 28800, 'true'); // 8 hours
        }
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE PASSWORD  (any role — changes own password)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/change-password', auth, async (req, res) => {
    const { old_password, new_password } = req.body;
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!old_password || !new_password) {
        return res.status(400).json({ error: 'Old and new passwords are required' });
    }
    if (new_password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    try {
        const adminRow = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.adminId]);
        if (adminRow.rows.length === 0) return res.status(404).json({ error: 'Admin not found' });

        const valid = await bcrypt.compare(old_password, adminRow.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

        const hashed = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE admin SET password_hash = $1 WHERE id = $2', [hashed, req.adminId]);

        // Blacklist old token so re-login is required
        if (token) {
            await redis.setex(`blacklist:${token}`, 28800, 'true');
        }

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE COMPANY NAME  (owner only)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/update-company', auth, requireOwner, async (req, res) => {
    const { company_name } = req.body;
    if (!company_name || !company_name.trim()) {
        return res.status(400).json({ error: 'Company name is required' });
    }
    try {
        await pool.query('UPDATE admin SET company_name = $1 WHERE id = $2', [company_name.trim(), req.adminId]);
        // Keep the role name in sync
        await pool.query(
            'UPDATE admin_roles SET name = $1 WHERE admin_id = $2 AND owner_id = $2',
            [company_name.trim(), req.adminId]
        );
        res.json({ message: 'Company name updated successfully' });
    } catch (error) {
        console.error('Update company error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROLE MANAGEMENT  (owner only)
// ─────────────────────────────────────────────────────────────────────────────

// List all team members under this owner
router.get('/team', auth, requireOwner, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ar.id, ar.admin_id, ar.email, ar.name, ar.role, ar.is_active, ar.created_at,
                    a.email as admin_email
             FROM admin_roles ar
             LEFT JOIN admin a ON ar.admin_id = a.id
             WHERE ar.owner_id = $1
             ORDER BY ar.created_at ASC`,
            [req.ownerId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Get team error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Invite a new manager or viewer
// If the email already has an admin account, links to it.
// Otherwise creates a new admin account with a temporary password.
router.post('/team/invite', auth, requireOwner, async (req, res) => {
    const { email, name, role, temp_password } = req.body;

    if (!email || !role) {
        return res.status(400).json({ error: 'Email and role are required' });
    }
    if (!['manager', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'Role must be manager or viewer' });
    }
    if (!temp_password || temp_password.length < 4) {
        return res.status(400).json({ error: 'Temporary password must be at least 4 characters' });
    }

    try {
        // Check if already invited under this owner
        const alreadyInvited = await pool.query(
            'SELECT id FROM admin_roles WHERE email = $1 AND owner_id = $2',
            [email, req.ownerId]
        );
        if (alreadyInvited.rows.length > 0) {
            return res.status(400).json({ error: 'This email is already a team member' });
        }

        // Find or create admin account
        let adminId;
        const existing = await pool.query('SELECT id FROM admin WHERE email = $1', [email]);

        if (existing.rows.length > 0) {
            adminId = existing.rows[0].id;
        } else {
            const hashed = await bcrypt.hash(temp_password, 10);
            // Use owner's company name as placeholder
            const ownerInfo = await pool.query('SELECT company_name FROM admin WHERE id = $1', [req.ownerId]);
            const company = ownerInfo.rows[0]?.company_name || 'Rental System';

            const newAdmin = await pool.query(
                'INSERT INTO admin (email, password_hash, company_name) VALUES ($1, $2, $3) RETURNING id',
                [email, hashed, company]
            );
            adminId = newAdmin.rows[0].id;
        }

        // Create role entry
        await pool.query(
            `INSERT INTO admin_roles (admin_id, owner_id, email, name, role)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (admin_id, owner_id) DO UPDATE SET role = $5, is_active = TRUE`,
            [adminId, req.ownerId, email, name || email, role]
        );

        res.json({ message: `${role} invited successfully`, email, role });
    } catch (error) {
        console.error('Invite error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update a team member's role
router.put('/team/:roleId', auth, requireOwner, async (req, res) => {
    const { role, is_active, name } = req.body;

    if (role && !['manager', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'Role must be manager or viewer' });
    }

    try {
        // Prevent owner from changing their own owner row
        const roleRow = await pool.query(
            'SELECT admin_id, role FROM admin_roles WHERE id = $1 AND owner_id = $2',
            [req.params.roleId, req.ownerId]
        );
        if (roleRow.rows.length === 0) {
            return res.status(404).json({ error: 'Team member not found' });
        }
        if (roleRow.rows[0].role === 'owner') {
            return res.status(403).json({ error: 'Cannot modify the owner role' });
        }

        const updates = [];
        const params = [];
        let idx = 1;

        if (role)                    { updates.push(`role = $${idx++}`);      params.push(role); }
        if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); params.push(is_active); }
        if (name)                    { updates.push(`name = $${idx++}`);      params.push(name); }

        if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

        params.push(req.params.roleId, req.ownerId);
        await pool.query(
            `UPDATE admin_roles SET ${updates.join(', ')} WHERE id = $${idx++} AND owner_id = $${idx}`,
            params
        );

        res.json({ message: 'Team member updated' });
    } catch (error) {
        console.error('Update team member error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Remove a team member (deactivate, not delete)
router.delete('/team/:roleId', auth, requireOwner, async (req, res) => {
    try {
        const roleRow = await pool.query(
            'SELECT role FROM admin_roles WHERE id = $1 AND owner_id = $2',
            [req.params.roleId, req.ownerId]
        );
        if (roleRow.rows.length === 0) return res.status(404).json({ error: 'Team member not found' });
        if (roleRow.rows[0].role === 'owner') {
            return res.status(403).json({ error: 'Cannot remove the owner' });
        }

        await pool.query(
            'UPDATE admin_roles SET is_active = FALSE WHERE id = $1 AND owner_id = $2',
            [req.params.roleId, req.ownerId]
        );
        res.json({ message: 'Team member removed' });
    } catch (error) {
        console.error('Remove team member error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
