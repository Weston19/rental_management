const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes
const authRoutes = require('./backend/routes/auth');
const propertyRoutes = require('./backend/routes/properties');
const roomRoutes = require('./backend/routes/rooms');
const tenantRoutes = require('./backend/routes/tenants');
const billRoutes = require('./backend/routes/bills');
const paymentRoutes = require('./backend/routes/payments');
const financialRoutes = require('./backend/routes/financials');
const settingsRoutes = require('./backend/routes/settings');
const messageRoutes = require('./backend/routes/messages');
const webhookRoutes = require('./backend/routes/webhooks');
const tenantPortalRoutes = require('./backend/routes/tenant-portal');
const mpesaRoutes = require('./backend/routes/mpesa');



const app = express();
const PORT = process.env.PORT || 5016;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files - THIS IS IMPORTANT
app.use('/uploads', express.static(path.join(__dirname, 'backend/uploads')));
app.use(express.static(path.join(__dirname, 'backend/public')));

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
    res.sendFile(path.join(__dirname, 'backend/public/index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('✅ Database connected successfully');
});