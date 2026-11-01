const redis = require('../redis');
const db = require('../db');
const { cacheTtlSec } = require('../config');

const key = (code) => `url:${code}`;

// Cache-aside read: Redis first -> PostgreSQL fallback -> repopulate Redis.
// Any Redis failure degrades gracefully to the database.
async function resolveShortCode(code) {
  try {
    const cached = await redis.get(key(code));
    if (cached) return { ...JSON.parse(cached), fromCache: true };
  } catch (e) {
    console.error('cache read failed, falling back to DB:', e.message);
  }

  const { rows } = await db.query(
    'SELECT id, original_url, expires_at FROM urls WHERE short_code = $1',
    [code]
  );
  if (!rows.length) return null;

  const rec = {
    id: rows[0].id,
    url: rows[0].original_url,
    exp: rows[0].expires_at ? new Date(rows[0].expires_at).getTime() : null,
  };

  // Repopulate cache; never let it outlive the link's expiry.
  let ttl = cacheTtlSec;
  if (rec.exp) ttl = Math.min(ttl, Math.floor((rec.exp - Date.now()) / 1000));
  if (ttl > 0) {
    redis.set(key(code), JSON.stringify(rec), 'EX', ttl).catch((e) =>
      console.error('cache write failed:', e.message)
    );
  }
  return { ...rec, fromCache: false };
}

async function invalidate(code) {
  try { await redis.del(key(code)); } catch (e) { console.error('cache delete failed:', e.message); }
}

module.exports = { resolveShortCode, invalidate };
