const jwt = require('jsonwebtoken');
const redis = require('../utils/redis');

module.exports = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        // Check if token is blacklisted
        const isBlacklisted = await redis.get(`blacklist:${token}`);
        if (isBlacklisted) {
            return res.status(401).json({ error: 'Token has been revoked.' });
        }

        const secret = process.env.JWT_SECRET || process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET;
        if (!secret) {
            return res.status(500).json({ error: 'JWT_SECRET environment variable is missing' });
        }
        const decoded = jwt.verify(token, secret);
        
        // Check if tenantId from token matches route param (if present)
        if (req.params.tenantId && String(req.params.tenantId) !== String(decoded.tenantId)) {
            return res.status(403).json({ error: 'Access forbidden. You can only access your own data.' });
        }

        req.tenantId = decoded.tenantId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token.' });
    }
};
