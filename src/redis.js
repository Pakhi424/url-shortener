const Redis = require('ioredis');
const { redisUrl } = require('./config');

const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
redis.on('error', (err) => console.error('Redis error:', err.message));

module.exports = redis;
