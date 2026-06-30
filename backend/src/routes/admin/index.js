const express = require('express');
const auth = require('../../middleware/auth');
const propertyRoutes = require('../properties');
const tenantRoutes = require('../tenants');
const roomRoutes = require('../rooms');
const billRoutes = require('../bills');
const financialRoutes = require('../financials');
const settingsRoutes = require('../settings');

const router = express.Router();
router.use(auth); // All admin routes require auth

router.use('/properties', propertyRoutes);
router.use('/tenants', tenantRoutes);
router.use('/rooms', roomRoutes);
router.use('/bills', billRoutes);
router.use('/financials', financialRoutes);
router.use('/settings', settingsRoutes);

module.exports = router;
