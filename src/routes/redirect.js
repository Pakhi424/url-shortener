const express = require('express');
const { rateLimit, enumerationGuard, recordMiss } = require('../middleware/rateLimit');
const { resolveShortCode } = require('../services/urlCache');
const { enqueueClick } = require('../services/clickQueue');

const router = express.Router();
const CODE_RE = /^[0-9A-Za-z_-]{3,32}$/;

router.get(
  '/:code',
  rateLimit({ name: 'redirect', windowSec: 60, max: 120 }), // general per-IP cap
  enumerationGuard,                                          // blocks IPs probing random codes
  async (req, res, next) => {
    try {
      const { code } = req.params;
      const rec = CODE_RE.test(code) ? await resolveShortCode(code) : null;

      if (!rec || (rec.exp && rec.exp < Date.now())) {
        await recordMiss(req.ip);
        return res.status(404).json({ error: 'Link not found' });
      }

      // 302 (not 301) so every click reaches us instead of being cached by browsers.
      res.redirect(302, rec.url);

      // Analytics happens after the response: never blocks the redirect.
      enqueueClick({
        urlId: rec.id,
        at: new Date().toISOString(),
        ip: req.ip,
        ua: (req.get('user-agent') || '').slice(0, 300),
        ref: (req.get('referer') || '').slice(0, 300),
      });
    } catch (e) { next(e); }
  }
);

module.exports = router;
