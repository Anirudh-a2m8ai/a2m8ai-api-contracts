import { db, isDbConfigured } from './db';
import { SEED_SPEC_YAML } from '@/generated/seed-spec';
import type { SpecVersion, Viewer } from './types';

/**
 * Storage for the contract itself.
 *
 * Append-only. An edit — whether the owner typing in the editor or an approved
 * proposal — inserts a new row rather than overwriting, so every state the
 * contract has ever been in stays readable and revertible.
 */

export const API_ID = 'ai-service';

export interface CurrentSpec {
  yaml: string;
  version: SpecVersion | null;
  /** 'db' once anything has been saved; 'seed' means the committed YAML. */
  source: 'db' | 'seed';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toVersion(row: any): SpecVersion {
  return {
    id: row.id,
    message: row.message ?? '',
    authorLogin: row.author_login,
    authorAvatar: row.author_avatar ?? null,
    fromProposal: row.from_proposal ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Adopts the committed contract as version 1 if the table is empty.
 *
 * Called by every read path, not just the one that renders the contract —
 * otherwise landing on History first, on a database that has just been
 * attached or reset, would report no versions while the reference showed
 * version 1.
 *
 * A guarded insert rather than check-then-write: two cold starts can race
 * here, and NOT EXISTS makes the loser a no-op instead of a duplicate.
 */
async function ensureSeeded(): Promise<void> {
  const sql = await db();
  await sql`
    INSERT INTO spec_versions (api_id, yaml, message, author_login)
    SELECT ${API_ID}, ${SEED_SPEC_YAML}, 'Imported from ai-service/openapi.yaml', 'system'
    WHERE NOT EXISTS (SELECT 1 FROM spec_versions WHERE api_id = ${API_ID})
  `;
}

/**
 * The published contract.
 *
 * With no database attached this returns the YAML committed in the repo, which
 * keeps a not-yet-configured deployment showing real documentation instead of
 * an error page. With a database attached but empty, the committed YAML is
 * adopted as version 1 — so the first thing anyone sees is the current
 * contract, not a blank editor.
 */
export async function getCurrentSpec(): Promise<CurrentSpec> {
  if (!isDbConfigured()) {
    return { yaml: SEED_SPEC_YAML, version: null, source: 'seed' };
  }

  await ensureSeeded();
  const sql = await db();

  const rows = await sql`
    SELECT * FROM spec_versions WHERE api_id = ${API_ID} ORDER BY id DESC LIMIT 1
  `;

  if (!rows.length) {
    // Only reachable if the insert above was rolled back under us.
    return { yaml: SEED_SPEC_YAML, version: null, source: 'seed' };
  }

  return { yaml: rows[0].yaml as string, version: toVersion(rows[0]), source: 'db' };
}

/** Publishes a new version. Callers must have already authorised the write. */
export async function saveSpecVersion(input: {
  yaml: string;
  message: string;
  author: Viewer;
  fromProposal?: number | null;
}): Promise<SpecVersion> {
  const sql = await db();
  const rows = await sql`
    INSERT INTO spec_versions (api_id, yaml, message, author_login, author_avatar, from_proposal)
    VALUES (
      ${API_ID},
      ${input.yaml},
      ${input.message || ''},
      ${input.author.login},
      ${input.author.avatar},
      ${input.fromProposal ?? null}
    )
    RETURNING *
  `;
  return toVersion(rows[0]);
}

/** Version history, newest first. Excludes the YAML — each row is ~160 KiB. */
export async function listVersions(limit = 50): Promise<SpecVersion[]> {
  if (!isDbConfigured()) return [];
  await ensureSeeded();
  const sql = await db();
  const rows = await sql`
    SELECT id, message, author_login, author_avatar, from_proposal, created_at
    FROM spec_versions
    WHERE api_id = ${API_ID}
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(toVersion);
}

export async function getVersionYaml(id: number): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const sql = await db();
  const rows = await sql`SELECT yaml FROM spec_versions WHERE id = ${id} AND api_id = ${API_ID}`;
  return rows.length ? (rows[0].yaml as string) : null;
}
