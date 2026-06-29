const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import only tenant-facing routes
const authRoutes = require('./routes/auth');
const tenantPortalRoutes = require('./routes/tenant-portal');
const paymentRoutes = require('./routes/payments');
const messageRoutes = require('./routes/messages');
const mpesaRoutes = require('./routes/mpesa');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes (Tenant has limited access)
app.use('/api/auth', authRoutes);
app.use('/api/tenant-portal', tenantPortalRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/mpesa', mpesaRoutes);

app.get('/api/test', (req, res) => {
    res.json({ message: 'Tenant backend working!' });
});

// Tenant login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/tenant-login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/tenant-dashboard.html'));
});

// Catch all for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/tenant-login.html'));
});

const PORT = process.env.PORT || 5016;
app.listen(PORT, () => {
    console.log(`🚀 Tenant server on port ${PORT}`);
});

module.exports = app;
