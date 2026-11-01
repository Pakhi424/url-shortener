const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { jwtSecret } = require('../config');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
// Strict limit on credential endpoints: 10 attempts / 15 min / IP
router.use(rateLimit({ name: 'auth', windowSec: 15 * 60, max: 10 }));

const sign = (u) => jwt.sign({ id: u.id, email: u.email }, jwtSecret, { expiresIn: '7d' });

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email))
      return res.status(400).json({ error: 'Valid email required' });
    if (typeof password !== 'string' || password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email.toLowerCase(), hash]
    );
    res.status(201).json({ token: sign(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await db.query('SELECT id, email, password_hash FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    const ok = rows.length && (await bcrypt.compare(password, rows[0].password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: sign(rows[0]) });
  } catch (e) { next(e); }
});

module.exports = router;
