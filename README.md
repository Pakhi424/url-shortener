# Scalable URL Shortener & Analytics Service
Node.js · Express.js · PostgreSQL · Redis

## Run
```bash
cp .env.example .env
docker compose up -d        # PostgreSQL + Redis
npm install
npm run migrate             # creates tables
npm run dev
```

## Try it
```bash
# register (returns a JWT)
curl -X POST localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"password123"}'

TOKEN=<paste token>

# create short URL (optional: "alias", "expiresInDays")
curl -X POST localhost:3000/api/urls -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"url":"https://example.com/some/long/path"}'

# visit it
curl -i localhost:3000/<shortCode>

# analytics (clicks appear within ~2s, after the worker flushes)
curl localhost:3000/api/urls/<shortCode>/analytics -H "Authorization: Bearer $TOKEN"
```

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register, /login | – | Get JWT |
| POST | /api/urls | ✓ | Create short URL |
| GET | /api/urls | ✓ | List my URLs |
| GET | /api/urls/:code/analytics | ✓ | Totals, daily clicks, referrers |
| DELETE | /api/urls/:code | ✓ | Delete + evict cache |
| GET | /:code | – | 302 redirect |

## How each resume bullet maps to code
| Bullet | Where |
|---|---|
| Authenticated service | `src/middleware/auth.js`, `src/routes/auth.js` (bcrypt + JWT) |
| Normalized schema, indexed lookups | `db/schema.sql` (users → urls → clicks; index on `short_code`, `(url_id, clicked_at)`) |
| Unique constraints | `urls_short_code_key`; insert retry on error `23505` in `src/routes/urls.js` |
| Redis cache-aside + DB fallback + repopulation | `src/services/urlCache.js` |
| Async click tracking | `src/services/clickQueue.js` (Redis list → batched bulk insert), enqueued after `res.redirect` |
| Rate limiting & anti-enumeration | `src/middleware/rateLimit.js` (per-IP/per-user limits, 404-miss guard) |

## Interview talking points
- 302 vs 301: 302 so clicks aren't hidden by browser caching.
- Cache TTL is capped by link expiry; delete evicts the cache key.
- Redis down → redirects still work via PostgreSQL; rate limiter fails open.
- Click queue: if a DB flush fails, the batch is pushed back and retried.
- Possible next steps: base62 counter IDs instead of random codes, read replicas, Redis Lua for atomic limiter, tests.
