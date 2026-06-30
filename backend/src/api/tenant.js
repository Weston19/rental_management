// Fix Supabase self-signed certificate issue
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const redis = require('../utils/redis');
const { upload, uploadFile, supabase } = require('../utils/storage');
const tenantAuth = require('../middleware/tenant-auth');
const runMigrations = require('../migrate');

// Import routes
const sharedRoutes = require('../routes/shared');
const tenantRoutes = require('../routes/tenant');

const app = express();
const PORT = process.env.PORT || 5017;

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../../public/tenant')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', waitForMigration, sharedRoutes);
app.use('/api', waitForMigration, tenantRoutes);

// Test endpoints
app.get('/api/test', (req, res) => res.json({ message: 'Tenant backend working!' }));
app.get('/api/test-redis', async (req, res) => {
    try {
        await redis.set('test', 'Redis is working!', { ex: 60 });
        const result = await redis.get('test');
        res.json({ message: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve tenant SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/tenant/login.html'));
});

// Start server if this file is run directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Tenant server on port ${PORT}`);
    });
}

module.exports = app;
