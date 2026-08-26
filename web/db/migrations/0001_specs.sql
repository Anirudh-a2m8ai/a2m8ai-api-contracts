-- One-time migration: introduces the `specs` registry table and renames
-- api_id -> spec_slug (now a real FK) on spec_versions, proposals, comments.
--
-- Run by hand, once, against a database created before the multi-spec split:
--
--   psql "$POSTGRES_URL" -f db/migrations/0001_specs.sql
--
-- This is NOT re-run by ensureSchema() on every cold start (that loop only
-- ever does CREATE TABLE/INDEX IF NOT EXISTS, which is safe to repeat but
-- cannot express a rename or a backfill). Run this once, then
-- web/src/lib/db.ts and web/db/schema.sql already reflect the target shape
-- for any brand new database.
--
-- Confirmed with the project owner: there is no real data to preserve, so
-- this assumes `npm run reset -- --yes` has already been run against the
-- target database — the three tables are empty, and no backfill is needed.
-- If that is no longer true by the time this runs, stop and reassess before
-- applying it.

BEGIN;

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

INSERT INTO specs (slug, name, description, source_dir, sort_order) VALUES
  ('course-outline',     'Course Outline',     '', 'course-outline',     0),
  ('content-generation', 'Content Generation', '', 'content-generation', 1)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE spec_versions RENAME COLUMN api_id TO spec_slug;
ALTER TABLE proposals     RENAME COLUMN api_id TO spec_slug;
ALTER TABLE comments      RENAME COLUMN api_id TO spec_slug;

ALTER TABLE spec_versions ALTER COLUMN spec_slug DROP DEFAULT;
ALTER TABLE proposals     ALTER COLUMN spec_slug DROP DEFAULT;
ALTER TABLE comments      ALTER COLUMN spec_slug DROP DEFAULT;

ALTER TABLE spec_versions ADD CONSTRAINT spec_versions_spec_fk FOREIGN KEY (spec_slug) REFERENCES specs (slug);
ALTER TABLE proposals     ADD CONSTRAINT proposals_spec_fk     FOREIGN KEY (spec_slug) REFERENCES specs (slug);
ALTER TABLE comments      ADD CONSTRAINT comments_spec_fk      FOREIGN KEY (spec_slug) REFERENCES specs (slug);

ALTER INDEX spec_versions_api_idx RENAME TO spec_versions_spec_idx;
ALTER INDEX proposals_api_idx     RENAME TO proposals_spec_idx;
ALTER INDEX comments_anchor_idx   RENAME TO comments_spec_anchor_idx;

COMMIT;
