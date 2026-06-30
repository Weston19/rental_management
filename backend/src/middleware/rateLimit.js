const redis = require('../redis');

// Rate limit for login attempts: max 5 attempts per 15 minutes
const loginRateLimiter = async (req, res, next) => {
  const { email, phone } = req.body;
  const key = email ? `login_attempts:${email}` : `login_attempts:${phone}`;
  
  try {
    // Get current attempts count
    const attempts = await redis.get(key);
    const currentAttempts = attempts ? parseInt(attempts) : 0;

    // If 5 or more attempts, block
    if (currentAttempts >= 5) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
    }

    // Increment attempts count, set TTL to 15 minutes
    await redis.incr(key);
    if (currentAttempts === 0) {
      await redis.expire(key, 900); // 15 minutes in seconds
    }

    next();
  } catch (error) {
    console.error('Rate limiter error:', error);
    // If Redis fails, let request proceed (fail open)
    next();
  }
};

module.exports = loginRateLimiter;
