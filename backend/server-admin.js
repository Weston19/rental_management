const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initRedis } = require('./redis');

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

// Initialize Redis
initRedis();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes (Admin has access to all)
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

app.get('/api/test', (req, res) => {
    res.json({ message: 'Admin backend working!' });
});

// Admin dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Catch all for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

const PORT = process.env.PORT || 5016;
app.listen(PORT, () => {
    console.log(`🚀 Admin server on port ${PORT}`);
});

module.exports = app;
