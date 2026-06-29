const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const redis = require('./redis');
const upload = require('./upload');
const auth = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
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
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/financials', financialRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/qstash', qstashRoutes);

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
adminRouter.use('/api/auth', authRoutes);
adminRouter.use('/api/properties', propertyRoutes);
adminRouter.use('/api/rooms', roomRoutes);
adminRouter.use('/api/tenants', tenantRoutes);
adminRouter.use('/api/bills', billRoutes);
adminRouter.use('/api/payments', paymentRoutes);
adminRouter.use('/api/financials', financialRoutes);
adminRouter.use('/api/settings', settingsRoutes);
adminRouter.use('/api/messages', messageRoutes);
adminRouter.use('/api/webhooks', webhookRoutes);
adminRouter.use('/api/mpesa', mpesaRoutes);
adminRouter.use('/api/qstash', qstashRoutes);

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
