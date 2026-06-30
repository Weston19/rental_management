const express = require('express');
const authRoutes = require('../auth');
const paymentRoutes = require('../payments');
const messageRoutes = require('../messages');
const mpesaRoutes = require('../mpesa');
const webhookRoutes = require('../webhooks');
const qstashRoutes = require('../qstash-jobs');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/payments', paymentRoutes);
router.use('/messages', messageRoutes);
router.use('/mpesa', mpesaRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/qstash', qstashRoutes);

module.exports = router;
