const express = require('express');
const db = require('../db');
const { baseUrl } = require('../config');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { generateShortCode } = require('../services/shortCode');
const { invalidate } = require('../services/urlCache');

const router = express.Router();
router.use(requireAuth);
router.use(rateLimit({ name: 'api', windowSec: 60, max: 60, keyFn: (req) => `u${req.user.id}` }));

const ALIAS_RE = /^[0-9A-Za-z_-]{3,32}$/;

function validUrl(s) {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && s.length <= 2048;
  } catch { return false; }
}

// Create a short URL
router.post('/', async (req, res, next) => {
  try {
    const { url, alias, expiresInDays } = req.body || {};
    if (!validUrl(url)) return res.status(400).json({ error: 'A valid http(s) URL is required' });
    if (alias !== undefined && !ALIAS_RE.test(alias))
      return res.status(400).json({ error: 'Alias must be 3-32 chars: letters, digits, _ or -' });

    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 86400000)
      : null;

    const insert = (code) =>
      db.query(
        `INSERT INTO urls (user_id, short_code, original_url, expires_at)
         VALUES ($1, $2, $3, $4) RETURNING short_code, original_url, expires_at, created_at`,
        [req.user.id, code, url, expiresAt]
      );

    // Uniqueness is enforced by the DB constraint, so concurrent inserts can't create
    // duplicates. On a collision (23505) we simply retry with a new random code.
    const isDup = (e) => e.code === '23505' && e.constraint === 'urls_short_code_key';

    if (alias) {
      try {
        const { rows } = await insert(alias);
        return res.status(201).json(format(rows[0]));
      } catch (e) {
        if (isDup(e)) return res.status(409).json({ error: 'Alias already taken' });
        throw e;
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await insert(generateShortCode(7));
        return res.status(201).json(format(rows[0]));
      } catch (e) {
        if (!isDup(e)) throw e;
      }
    }
    res.status(503).json({ error: 'Could not allocate a short code, try again' });
  } catch (e) { next(e); }
});

const format = (r) => ({
  shortCode: r.short_code,
  shortUrl: `${baseUrl}/${r.short_code}`,
  originalUrl: r.original_url,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

// List my URLs
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT short_code, original_url, click_count, expires_at, created_at
       FROM urls WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows.map((r) => ({ ...format(r), clicks: Number(r.click_count) })));
  } catch (e) { next(e); }
});

// Analytics for one URL (owner only)
router.get('/:code/analytics', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, short_code, click_count FROM urls WHERE short_code = $1 AND user_id = $2',
      [req.params.code, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const { id } = rows[0];

    const [daily, referrers] = await Promise.all([
      db.query(
        `SELECT date_trunc('day', clicked_at)::date AS day, COUNT(*)::int AS clicks
         FROM clicks WHERE url_id = $1 AND clicked_at > now() - interval '30 days'
         GROUP BY 1 ORDER BY 1`,
        [id]
      ),
      db.query(
        `SELECT COALESCE(NULLIF(referrer, ''), 'direct') AS referrer, COUNT(*)::int AS clicks
         FROM clicks WHERE url_id = $1 GROUP BY 1 ORDER BY clicks DESC LIMIT 10`,
        [id]
      ),
    ]);

    res.json({
      shortCode: rows[0].short_code,
      totalClicks: Number(rows[0].click_count),
      last30Days: daily.rows,
      topReferrers: referrers.rows,
    });
  } catch (e) { next(e); }
});

// Delete (also evicts cache)
router.delete('/:code', async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM urls WHERE short_code = $1 AND user_id = $2',
      [req.params.code, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    await invalidate(req.params.code);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
