-- Schema for the hosted API contract reference.
--
-- Applied automatically on first request (see src/lib/db.ts -> ensureSchema),
-- so a fresh Vercel Postgres needs no manual migration step. Kept here as the
-- readable source of truth and for anyone who prefers to run it by hand:
--
--   psql "$POSTGRES_URL" -f db/schema.sql

-- Every accepted state of the contract. Append-only: an edit never overwrites,
-- it adds a row, so the full history stays inspectable and revertible.
CREATE TABLE IF NOT EXISTS spec_versions (
  id            SERIAL PRIMARY KEY,
  api_id        TEXT        NOT NULL DEFAULT 'ai-service',
  yaml          TEXT        NOT NULL,
  message       TEXT        NOT NULL DEFAULT '',
  author_login  TEXT        NOT NULL,
  author_avatar TEXT,
  -- Set when this version came from an approved proposal rather than a direct
  -- owner edit. Nullable rather than a FK: proposals reference versions too,
  -- and a hard cycle would make either insert order impossible.
  from_proposal INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spec_versions_api_idx ON spec_versions (api_id, id DESC);

-- An edit request. Anyone signed in may open one; only the owner may merge it.
CREATE TABLE IF NOT EXISTS proposals (
  id              SERIAL PRIMARY KEY,
  api_id          TEXT        NOT NULL DEFAULT 'ai-service',
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL DEFAULT '',
  yaml            TEXT        NOT NULL,
  base_version_id INTEGER     REFERENCES spec_versions (id),
  -- open | merged | rejected | withdrawn
  status          TEXT        NOT NULL DEFAULT 'open',
  author_login    TEXT        NOT NULL,
  author_avatar   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  resolution_note TEXT,
  merged_version_id INTEGER   REFERENCES spec_versions (id)
);

CREATE INDEX IF NOT EXISTS proposals_api_idx ON proposals (api_id, status, id DESC);

-- Comments pinned to a part of the contract. `anchor` is our own stable
-- addressing scheme (see src/lib/anchors.ts), e.g. "op:post /api/v1/outline"
-- or "schema:ErrorResponse#errorCode". proposal_id is set for discussion on an
-- edit request instead of on the published contract.
CREATE TABLE IF NOT EXISTS comments (
  id            SERIAL PRIMARY KEY,
  api_id        TEXT        NOT NULL DEFAULT 'ai-service',
  anchor        TEXT        NOT NULL,
  -- Snapshot of the human label at write time, so a comment stays readable
  -- after the operation it points at is renamed or removed.
  anchor_label  TEXT        NOT NULL DEFAULT '',
  proposal_id   INTEGER     REFERENCES proposals (id) ON DELETE CASCADE,
  parent_id     INTEGER     REFERENCES comments (id) ON DELETE CASCADE,
  body          TEXT        NOT NULL,
  author_login  TEXT        NOT NULL,
  author_avatar TEXT,
  resolved      BOOLEAN     NOT NULL DEFAULT FALSE,
  resolved_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_anchor_idx   ON comments (api_id, anchor);
CREATE INDEX IF NOT EXISTS comments_proposal_idx ON comments (proposal_id);
