const express = require('express');
const tenantPortalRoutes = require('../tenant-portal');

const router = express.Router();
router.use('/tenant-portal', tenantPortalRoutes);

module.exports = router;
