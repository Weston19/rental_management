const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    try {
        const decoded = jwt.verify(token, process.env.NEXT_PUBLIC_SUPABASE_URL_SUPABASE_JWT_SECRET);
        req.adminId = decoded.adminId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token.' });
    }
};