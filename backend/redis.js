const { Redis } = require('@upstash/redis');
require('dotenv').config();

let redisClient;

const initRedis = () => {
    try {
        redisClient = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
        });
        console.log('✅ Redis connected successfully');
        return redisClient;
    } catch (error) {
        console.error('Failed to connect to Redis:', error);
        return null;
    }
};

const getRedisClient = () => {
    return redisClient;
};

module.exports = {
    initRedis,
    getRedisClient
};
