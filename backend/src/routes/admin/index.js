const express = require('express');
const auth = require('../../middleware/auth');
const propertyRoutes = require('../properties');
const tenantRoutes = require('../tenants');
const roomRoutes = require('../rooms');
const billRoutes = require('../bills');
const financialRoutes = require('../financials');
const settingsRoutes = require('../settings');
const paymentsRoutes = require('../payments');
const paystackRoutes = require('../paystack');
const qstashRoutes = require('../qstash-jobs');

const router = express.Router();

// Non-auth routes (webhooks, qstash)
router.use('/qstash', qstashRoutes);
router.use('/paystack', paystackRoutes);

// Auth-required routes
router.use(auth);
router.use('/properties', propertyRoutes);
router.use('/tenants', tenantRoutes);
router.use('/rooms', roomRoutes);
router.use('/bills', billRoutes);
router.use('/financials', financialRoutes);
router.use('/settings', settingsRoutes);
router.use('/payments', paymentsRoutes);

module.exports = router;
