-- Schema for the hosted API contract reference.
--
-- Applied automatically on first request (see src/lib/db.ts -> ensureSchema),
-- so a fresh Vercel Postgres needs no manual migration step. Kept here as the
-- readable source of truth and for anyone who prefers to run it by hand:
--
--   psql "$POSTGRES_URL" -f db/schema.sql
--
-- A database created before the multi-spec change needs the one-time
-- migration in db/migrations/0001_specs.sql instead — this file is the target
-- shape for a brand new database, not an upgrade path.

-- The registry of specs this app hosts (course-outline, content-generation).
-- Code-managed: web/src/lib/specs-registry.ts is the source of truth, upserted
-- into this table on every ensureSchema() run. Slug is the primary key rather
-- than a surrogate id — it's the identifier every URL, page route and API
-- route already carries, and every FK column below is TEXT already.
CREATE TABLE IF NOT EXISTS specs (
  slug        TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  source_dir  TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  archived    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT specs_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Every accepted state of a spec's contract. Append-only: an edit never
-- overwrites, it adds a row, so the full history stays inspectable and
-- revertible.
CREATE TABLE IF NOT EXISTS spec_versions (
  id            SERIAL PRIMARY KEY,
  spec_slug     TEXT        NOT NULL REFERENCES specs (slug),
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

CREATE INDEX IF NOT EXISTS spec_versions_spec_idx ON spec_versions (spec_slug, id DESC);

-- An edit request. Anyone signed in may open one; only the owner may merge it.
CREATE TABLE IF NOT EXISTS proposals (
  id              SERIAL PRIMARY KEY,
  spec_slug       TEXT        NOT NULL REFERENCES specs (slug),
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

CREATE INDEX IF NOT EXISTS proposals_spec_idx ON proposals (spec_slug, status, id DESC);

-- Comments pinned to a part of a spec's contract. `anchor` is our own stable
-- addressing scheme (see src/lib/anchors.ts), e.g. "op:post /api/v1/outline"
-- or "schema:ErrorResponse#errorCode". proposal_id is set for discussion on an
-- edit request instead of on the published contract.
CREATE TABLE IF NOT EXISTS comments (
  id            SERIAL PRIMARY KEY,
  spec_slug     TEXT        NOT NULL REFERENCES specs (slug),
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

CREATE INDEX IF NOT EXISTS comments_spec_anchor_idx ON comments (spec_slug, anchor);
CREATE INDEX IF NOT EXISTS comments_proposal_idx    ON comments (proposal_id);
