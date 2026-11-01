-- Users
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- URLs
-- The UNIQUE constraint on short_code does two jobs:
--   1) integrity: the database itself rejects duplicate codes (race-safe)
--   2) performance: it creates a B-tree index used by redirect lookups
CREATE TABLE IF NOT EXISTS urls (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  short_code   VARCHAR(32) NOT NULL,
  original_url TEXT        NOT NULL,
  click_count  BIGINT      NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT urls_short_code_key UNIQUE (short_code)
);
CREATE INDEX IF NOT EXISTS idx_urls_user_id ON urls (user_id);

-- Click events (normalized: one row per click, references urls)
CREATE TABLE IF NOT EXISTS clicks (
  id         BIGSERIAL PRIMARY KEY,
  url_id     BIGINT      NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip         TEXT,
  user_agent TEXT,
  referrer   TEXT
);
CREATE INDEX IF NOT EXISTS idx_clicks_url_time ON clicks (url_id, clicked_at DESC);
