const redis = require('../redis');

// Fixed-window limiter backed by Redis (shared across app instances).
function rateLimit({ name, windowSec, max, keyFn }) {
  return async (req, res, next) => {
    try {
      const id = keyFn ? keyFn(req) : req.ip;
      const key = `rl:${name}:${id}`;
      const [[, count], [, ttl]] = await redis.multi().incr(key).ttl(key).exec();
      if (ttl < 0) await redis.expire(key, windowSec); // set TTL on first hit (or repair)

      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', String(Math.max(0, max - count)));
      if (count > max) {
        res.set('Retry-After', String(ttl > 0 ? ttl : windowSec));
        return res.status(429).json({ error: 'Too many requests, slow down.' });
      }
    } catch (e) {
      console.error('rate limiter unavailable, failing open:', e.message);
    }
    next();
  };
}

// Brute-force enumeration guard: count 404s per IP and block when too many.
const MISS_MAX = 20;
const MISS_WINDOW = 60;

async function enumerationGuard(req, res, next) {
  try {
    const misses = Number(await redis.get(`rl:miss:${req.ip}`)) || 0;
    if (misses >= MISS_MAX) {
      return res.status(429).json({ error: 'Too many invalid links. Try again later.' });
    }
  } catch (e) {
    console.error('enumeration guard unavailable:', e.message);
  }
  next();
}

async function recordMiss(ip) {
  try {
    const key = `rl:miss:${ip}`;
    const [[, count]] = await redis.multi().incr(key).expire(key, MISS_WINDOW, 'NX').exec();
    return count;
  } catch (e) {
    console.error('recordMiss failed:', e.message);
  }
}

module.exports = { rateLimit, enumerationGuard, recordMiss };
