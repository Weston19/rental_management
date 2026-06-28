const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

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
const tenantPortalRoutes = require('./routes/tenant-portal');
const mpesaRoutes = require('./routes/mpesa');



const app = express();
const PORT = process.env.PORT || 5016;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files - THIS IS IMPORTANT
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

// API Routes
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
app.use('/api/tenant-portal', tenantPortalRoutes);
app.use('/api/mpesa', mpesaRoutes);
// Test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'Backend is working!' });
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('✅ Database connected successfully');
});