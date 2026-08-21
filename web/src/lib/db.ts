import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

/**
 * Postgres access.
 *
 * The database is deliberately optional. With no connection string configured
 * the site still serves the contract committed in the repo, read-only — a
 * deploy that has not had Storage attached yet renders docs instead of a stack
 * trace. Everything that writes checks `isDbConfigured()` first.
 */

function connectionString(): string | undefined {
  // POSTGRES_URL is what Vercel Storage injects; DATABASE_URL is the
  // bring-your-own-Neon convention. Accept either.
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    undefined
  );
}

export function isDbConfigured(): boolean {
  return Boolean(connectionString());
}

/** Thrown when a write is attempted with no database attached. */
export class DbUnavailableError extends Error {
  constructor() {
    super(
      'No database is attached to this deployment. In Vercel: Storage -> Create Database -> Postgres.',
    );
    this.name = 'DbUnavailableError';
  }
}

let client: NeonQueryFunction<false, false> | undefined;

function rawClient(): NeonQueryFunction<false, false> {
  const url = connectionString();
  if (!url) throw new DbUnavailableError();
  if (!client) client = neon(url);
  return client;
}

// Kept in lockstep with db/schema.sql, which is the readable copy. The neon
// HTTP driver runs one statement per round trip, so the DDL lives here as
// discrete statements rather than being read from that file — `web/` is the
// Vercel root directory, and db/schema.sql is not guaranteed to be in the
// serverless bundle.
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS spec_versions (
     id            SERIAL PRIMARY KEY,
     api_id        TEXT        NOT NULL DEFAULT 'ai-service',
     yaml          TEXT        NOT NULL,
     message       TEXT        NOT NULL DEFAULT '',
     author_login  TEXT        NOT NULL,
     author_avatar TEXT,
     from_proposal INTEGER,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS spec_versions_api_idx ON spec_versions (api_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS proposals (
     id                SERIAL PRIMARY KEY,
     api_id            TEXT        NOT NULL DEFAULT 'ai-service',
     title             TEXT        NOT NULL,
     body              TEXT        NOT NULL DEFAULT '',
     yaml              TEXT        NOT NULL,
     base_version_id   INTEGER     REFERENCES spec_versions (id),
     status            TEXT        NOT NULL DEFAULT 'open',
     author_login      TEXT        NOT NULL,
     author_avatar     TEXT,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     resolved_at       TIMESTAMPTZ,
     resolved_by       TEXT,
     resolution_note   TEXT,
     merged_version_id INTEGER     REFERENCES spec_versions (id)
   )`,
  `CREATE INDEX IF NOT EXISTS proposals_api_idx ON proposals (api_id, status, id DESC)`,
  `CREATE TABLE IF NOT EXISTS comments (
     id            SERIAL PRIMARY KEY,
     api_id        TEXT        NOT NULL DEFAULT 'ai-service',
     anchor        TEXT        NOT NULL,
     anchor_label  TEXT        NOT NULL DEFAULT '',
     proposal_id   INTEGER     REFERENCES proposals (id) ON DELETE CASCADE,
     parent_id     INTEGER     REFERENCES comments (id) ON DELETE CASCADE,
     body          TEXT        NOT NULL,
     author_login  TEXT        NOT NULL,
     author_avatar TEXT,
     resolved      BOOLEAN     NOT NULL DEFAULT FALSE,
     resolved_by   TEXT,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS comments_anchor_idx   ON comments (api_id, anchor)`,
  `CREATE INDEX IF NOT EXISTS comments_proposal_idx ON comments (proposal_id)`,
];

let schemaReady: Promise<void> | undefined;

/**
 * Idempotent CREATE TABLE IF NOT EXISTS pass, memoised per lambda instance so
 * it costs one round trip on a cold start and nothing afterwards. On failure
 * the memo is cleared so the next request retries rather than caching the error.
 */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = rawClient();
    schemaReady = (async () => {
      for (const statement of SCHEMA) await sql.query(statement);
    })().catch((err) => {
      schemaReady = undefined;
      throw err;
    });
  }
  return schemaReady;
}

/**
 * A query function with the schema guaranteed to exist.
 *
 *   const rows = await db();
 *   await rows`SELECT 1`;
 */
export async function db(): Promise<NeonQueryFunction<false, false>> {
  const sql = rawClient();
  await ensureSchema();
  return sql;
}
