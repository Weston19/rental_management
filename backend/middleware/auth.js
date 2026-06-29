const jwt = require('jsonwebtoken');
const redis = require('../redis');
const pool = require('../db');

/**
 * Auth middleware — verifies the JWT and attaches to req:
 *   req.adminId  – the ID of the authenticated admin
 *   req.ownerId  – the root owner's ID (use this for ALL data-scoping queries)
 *   req.role     – 'owner' | 'manager' | 'viewer'
 *
 * Gracefully handles the case where admin_roles doesn't exist yet
 * (migration pending) by defaulting to owner role so the system
 * keeps working immediately after deploy.
 */
module.exports = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        // 1. Check token blacklist
        try {
            const isBlacklisted = await redis.get(`blacklist:${token}`);
            if (isBlacklisted) {
                return res.status(401).json({ error: 'Token has been revoked.' });
            }
        } catch (_) {
            // Redis unavailable — skip blacklist check, don't block the request
        }

        // 2. Verify JWT signature
        const decoded = jwt.verify(
            token,
            process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET
        );

        // Support both old tokens (only adminId) and new tokens (adminId + ownerId)
        const adminId = decoded.adminId;
        // Old tokens won't have ownerId — fall back to adminId (they are the owner)
        let ownerId = decoded.ownerId || adminId;
        let role    = 'owner';

        // 3. Look up live role from DB (gives us correct ownerId + role)
        try {
            const roleResult = await pool.query(
                `SELECT ar.owner_id, ar.role, ar.is_active
                 FROM admin_roles ar
                 WHERE ar.admin_id = $1 AND ar.owner_id = $2`,
                [adminId, ownerId]
            );

            if (roleResult.rows.length > 0) {
                if (!roleResult.rows[0].is_active) {
                    return res.status(403).json({ error: 'Account has been deactivated.' });
                }
                ownerId = roleResult.rows[0].owner_id;
                role    = roleResult.rows[0].role;
            } else {
                // Row missing — auto-create owner entry so the admin isn't locked out
                try {
                    await pool.query(
                        `INSERT INTO admin_roles (admin_id, owner_id, email, name, role)
                         SELECT $1, $1, email, company_name, 'owner'
                         FROM admin WHERE id = $1
                         ON CONFLICT (admin_id, owner_id) DO NOTHING`,
                        [adminId]
                    );
                } catch (_) {
                    // Table still doesn't exist — that's fine, defaults are already set
                }
                ownerId = adminId;
                role    = 'owner';
            }
        } catch (dbErr) {
            // admin_roles table doesn't exist yet (pre-migration) — fail open with
            // owner defaults so the app keeps working until migration runs
            if (dbErr.code === '42P01') { // undefined_table
                ownerId = adminId;
                role    = 'owner';
            } else {
                throw dbErr; // real DB error — let it surface
            }
        }

        req.adminId = adminId;
        req.ownerId = ownerId;
        req.role    = role;

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token.' });
        }
        console.error('Auth middleware error:', error.message);
        res.status(500).json({ error: 'Authentication error.' });
    }
};
