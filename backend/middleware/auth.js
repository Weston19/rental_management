const jwt = require('jsonwebtoken');
const redis = require('../redis');
const pool = require('../db');

/**
 * Auth middleware — verifies the JWT and attaches to req:
 *   req.adminId  – the ID of the authenticated admin (could be owner, manager, or viewer)
 *   req.ownerId  – the root owner's ID (always use this for data scoping queries)
 *   req.role     – 'owner' | 'manager' | 'viewer'
 */
module.exports = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        // Check token blacklist
        const isBlacklisted = await redis.get(`blacklist:${token}`);
        if (isBlacklisted) {
            return res.status(401).json({ error: 'Token has been revoked.' });
        }

        const decoded = jwt.verify(token, process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET);

        // Fetch role row so we get ownerId and role in one query
        const roleResult = await pool.query(
            `SELECT ar.owner_id, ar.role, ar.is_active
             FROM admin_roles ar
             WHERE ar.admin_id = $1 AND ar.owner_id = $2`,
            [decoded.adminId, decoded.ownerId]
        );

        if (roleResult.rows.length === 0 || !roleResult.rows[0].is_active) {
            return res.status(403).json({ error: 'Account inactive or role not found.' });
        }

        req.adminId = decoded.adminId;
        req.ownerId = decoded.ownerId;   // always the root owner — use for data isolation
        req.role    = roleResult.rows[0].role;

        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token.' });
    }
};
