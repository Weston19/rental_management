// Fix Supabase self-signed certificate issue
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const redis = require('../utils/redis');
const { upload, uploadFile, supabase } = require('../utils/storage');
const auth = require('../middleware/auth');
const runMigrations = require('../migrate');

// Import routes
const sharedRoutes = require('../routes/shared');
const adminRoutes = require('../routes/admin');

const app = express();
const PORT = process.env.PORT || 5016;

// ── Migration Gate ────────────────────────────────────────────────────────────
let migrationReady = false;
const migrationPromise = runMigrations()
    .then(() => { migrationReady = true; })
    .catch(err => {
        console.error('⚠️  Migration error (non-fatal):', err.message);
        migrationReady = true;
    });

function waitForMigration(req, res, next) {
    if (migrationReady) return next();
    migrationPromise.then(() => next()).catch(() => next());
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());

// RAW BODY for Paystack webhook (BEFORE any JSON parsing)
app.use('/api/paystack/webhook', express.raw({ type: 'application/json' }));

// Regular JSON parsing for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/admin', express.static(path.join(__dirname, '../../public/admin')));
app.use(express.static(path.join(__dirname, '../../public/admin')));

// ── Upload Endpoint ───────────────────────────────────────────────────────────
app.post('/api/upload/:type', waitForMigration, auth, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const { type } = req.params;
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileName = `${type}/${uniqueSuffix}-${req.file.originalname}`;

    try {
        const publicUrl = await uploadFile(req.file, 'uploads', fileName);
        res.json({ imageUrl: publicUrl });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', waitForMigration, sharedRoutes);
app.use('/api', waitForMigration, adminRoutes);

// Test endpoints
app.get('/api/test', (req, res) => res.json({ message: 'Admin backend working!' }));
app.get('/api/test-redis', async (req, res) => {
    try {
        await redis.set('test', 'Redis is working!', { ex: 60 });
        const result = await redis.get('test');
        res.json({ message: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve admin SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/admin/index.html'));
});

// Start server if this file is run directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Admin server on port ${PORT}`);
    });
}

module.exports = app;
