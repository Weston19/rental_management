const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const redis = require('./redis');
const upload = require('./upload');
const auth = require('./middleware/auth');
const runMigrations = require('./migrate');

// ── Migration gate ────────────────────────────────────────────────────────────
// On Vercel, app.listen never fires, so we run migrations at module load time.
// migrationReady resolves once migrations finish (or fail non-fatally).
// All API requests wait for this promise before being processed.
let migrationReady;
const migrationPromise = runMigrations()
    .then(() => { migrationReady = true; })
    .catch(err => {
        console.error('Startup migration failed (non-fatal):', err.message);
        migrationReady = true; // unblock requests even if migration failed
    });

function waitForMigration(req, res, next) {
    if (migrationReady) return next();
    migrationPromise.then(() => next()).catch(() => next());
}
// ─────────────────────────────────────────────────────────────────────────────

// Import routes
const authRoutes = require('./routes/auth');
const tenantPortalRoutes = require('./routes/tenant-portal');
const propertyRoutes = require('./routes/properties');
const roomRoutes = require('./routes/rooms');
const tenantRoutes = require('./routes/tenants');
const billRoutes = require('./routes/bills');
const paymentRoutes = require('./routes/payments');
const financialRoutes = require('./routes/financials');
const settingsRoutes = require('./routes/settings');
const messageRoutes = require('./routes/messages');
const webhookRoutes = require('./routes/webhooks');
const mpesaRoutes = require('./routes/mpesa');
const qstashRoutes = require('./routes/qstash-jobs');

const app = express();
const adminRouter = express.Router();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Upload endpoint
app.post('/api/upload/:type', auth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Return the URL to access the uploaded file
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

// API Routes (available from both root and /admin)
app.use('/api/auth', waitForMigration, authRoutes);
app.use('/api/tenant-portal', waitForMigration, tenantPortalRoutes);
app.use('/api/properties', waitForMigration, propertyRoutes);
app.use('/api/rooms', waitForMigration, roomRoutes);
app.use('/api/tenants', waitForMigration, tenantRoutes);
app.use('/api/bills', waitForMigration, billRoutes);
app.use('/api/payments', waitForMigration, paymentRoutes);
app.use('/api/financials', waitForMigration, financialRoutes);
app.use('/api/settings', waitForMigration, settingsRoutes);
app.use('/api/messages', waitForMigration, messageRoutes);
app.use('/api/webhooks', waitForMigration, webhookRoutes);
app.use('/api/mpesa', waitForMigration, mpesaRoutes);
app.use('/api/qstash', waitForMigration, qstashRoutes);

app.get('/api/test', (req, res) => {
    res.json({ message: 'Admin backend working!' });
});

// Test Redis connection
app.get('/api/test-redis', async (req, res) => {
    try {
        await redis.set('test', 'Redis is working!', { ex: 60 });
        const result = await redis.get('test');
        res.json({ message: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin router setup (for /admin path)
adminRouter.use(cors());
adminRouter.use(express.json());
adminRouter.use(express.urlencoded({ extended: true }));
adminRouter.use(express.static(path.join(__dirname, 'public')));

// Upload endpoint on admin
adminRouter.post('/api/upload/:type', auth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Return the URL to access the uploaded file
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

// API Routes on /admin
adminRouter.use('/api/auth', waitForMigration, authRoutes);
adminRouter.use('/api/tenant-portal', waitForMigration, tenantPortalRoutes);
adminRouter.use('/api/properties', waitForMigration, propertyRoutes);
adminRouter.use('/api/rooms', waitForMigration, roomRoutes);
adminRouter.use('/api/tenants', waitForMigration, tenantRoutes);
adminRouter.use('/api/bills', waitForMigration, billRoutes);
adminRouter.use('/api/payments', waitForMigration, paymentRoutes);
adminRouter.use('/api/financials', waitForMigration, financialRoutes);
adminRouter.use('/api/settings', waitForMigration, settingsRoutes);
adminRouter.use('/api/messages', waitForMigration, messageRoutes);
adminRouter.use('/api/webhooks', waitForMigration, webhookRoutes);
adminRouter.use('/api/mpesa', waitForMigration, mpesaRoutes);
adminRouter.use('/api/qstash', waitForMigration, qstashRoutes);

adminRouter.get('/api/test', (req, res) => {
    res.json({ message: 'Admin backend working!' });
});

// Admin dashboard (on /admin path)
adminRouter.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Catch all for SPA (on /admin path)
adminRouter.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Mount the admin router
app.use('/admin', adminRouter);

// Also handle direct host-based routing (for custom domain later)
app.use('/', (req, res, next) => {
    // If accessed via custom domain (admin.primmeholdings.co.ke), serve admin
    if (req.headers.host === 'admin.primmeholdings.co.ke') {
        adminRouter(req, res, next);
    } else {
        next();
    }
});

const PORT = process.env.PORT || 5016;
app.listen(PORT, () => {
    console.log(`🚀 Admin server on port ${PORT}`);
});

module.exports = app;
