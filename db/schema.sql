-- Cathedral Pinball — Relational Database Schema (PostgreSQL / Neon compatible)
-- Used when provisioning a dedicated SQL backend alongside the built-in Vercel Runtime Cache store.

CREATE TABLE IF NOT EXISTS users (
  user_id         TEXT PRIMARY KEY,
  friend_code     TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  initials        CHAR(3) NOT NULL,
  avatar_color    TEXT NOT NULL DEFAULT '#38bdf8',
  role            TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'vip', 'admin')),
  banned          BOOLEAN NOT NULL DEFAULT FALSE,
  games_played    INTEGER NOT NULL DEFAULT 0,
  total_score     BIGINT NOT NULL DEFAULT 0,
  best_score      INTEGER NOT NULL DEFAULT 0,
  best_multiplier SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_best_score ON users (best_score DESC);
CREATE INDEX IF NOT EXISTS idx_users_friend_code ON users (friend_code);

CREATE TABLE IF NOT EXISTS friendships (
  user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  friend_user_id  TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_user_id),
  CHECK (user_id <> friend_user_id)
);

CREATE TABLE IF NOT EXISTS scores (
  score_id        TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  score           INTEGER NOT NULL CHECK (score > 0 AND score <= 5000000),
  max_multiplier  SMALLINT NOT NULL DEFAULT 1 CHECK (max_multiplier BETWEEN 1 AND 16),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_leaderboard ON scores (score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores (user_id, score DESC);

CREATE TABLE IF NOT EXISTS live_config (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  announcement        TEXT NOT NULL DEFAULT '',
  double_score_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id    TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT ''
);
