const jwt = require('jsonwebtoken');
const redis = require('../redis');

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

        const decoded = jwt.verify(token, process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET);
        req.adminId = decoded.adminId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token.' });
    }
};