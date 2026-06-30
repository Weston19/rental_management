const { Redis } = require('@upstash/redis');
require('dotenv').config();

const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

module.exports = redis;
