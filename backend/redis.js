const { Redis } = require('@upstash/redis');

// Support both KV_* and UPSTASH_REDIS_* variable names (for compatibility)
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redis = new Redis({
  url: redisUrl,
  token: redisToken
});

module.exports = redis;
