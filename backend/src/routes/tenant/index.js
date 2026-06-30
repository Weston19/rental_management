const express = require('express');
const tenantAuth = require('../../middleware/tenant-auth');
const tenantPortalRoutes = require('../tenant-portal');

const router = express.Router();
router.use(tenantAuth); // All tenant routes require auth

router.use('/portal', tenantPortalRoutes);

module.exports = router;
