import { db, isDbConfigured } from './db';
import { API_ID } from './spec';
import { anchorLabel } from './anchors';
import type { Comment, Proposal, ProposalStatus, Viewer } from './types';

// Re-exported so server pages can reach it without a second import; the
// implementation lives in lib/thread.ts because client components need it
// too and must not pull the database driver into the browser bundle.
export { threadComments } from './thread';

/** Queries for comments and edit requests. Authorisation happens in the routes. */

/* eslint-disable @typescript-eslint/no-explicit-any */

function toComment(row: any): Comment {
  return {
    id: row.id,
    anchor: row.anchor,
    anchorLabel: row.anchor_label || anchorLabel(row.anchor),
    proposalId: row.proposal_id ?? null,
    parentId: row.parent_id ?? null,
    body: row.body,
    authorLogin: row.author_login,
    authorAvatar: row.author_avatar ?? null,
    resolved: Boolean(row.resolved),
    resolvedBy: row.resolved_by ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toProposal(row: any): Proposal {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    status: row.status as ProposalStatus,
    authorLogin: row.author_login,
    authorAvatar: row.author_avatar ?? null,
    baseVersionId: row.base_version_id ?? null,
    mergedVersionId: row.merged_version_id ?? null,
    resolutionNote: row.resolution_note ?? null,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    commentCount: row.comment_count === undefined ? undefined : Number(row.comment_count),
    ...(row.yaml === undefined ? {} : { yaml: row.yaml as string }),
  };
}

/* ------------------------------ comments ------------------------------ */

/**
 * Every comment on the published contract, flat.
 *
 * The viewer needs counts for all anchors at once to draw the pin badges, and
 * the whole set is a single small query — cheaper than one request per anchor
 * as the reader scrolls.
 */
export async function listSpecComments(): Promise<Comment[]> {
  if (!isDbConfigured()) return [];
  const sql = await db();
  const rows = await sql`
    SELECT * FROM comments
    WHERE api_id = ${API_ID} AND proposal_id IS NULL
    ORDER BY id ASC
  `;
  return rows.map(toComment);
}

export async function listProposalComments(proposalId: number): Promise<Comment[]> {
  if (!isDbConfigured()) return [];
  const sql = await db();
  const rows = await sql`
    SELECT * FROM comments WHERE proposal_id = ${proposalId} ORDER BY id ASC
  `;
  return rows.map(toComment);
}


export async function createComment(input: {
  anchor: string;
  anchorLabel: string;
  body: string;
  author: Viewer;
  proposalId?: number | null;
  parentId?: number | null;
}): Promise<Comment> {
  const sql = await db();
  const rows = await sql`
    INSERT INTO comments (api_id, anchor, anchor_label, proposal_id, parent_id, body, author_login, author_avatar)
    VALUES (
      ${API_ID},
      ${input.anchor},
      ${input.anchorLabel},
      ${input.proposalId ?? null},
      ${input.parentId ?? null},
      ${input.body},
      ${input.author.login},
      ${input.author.avatar}
    )
    RETURNING *
  `;
  return toComment(rows[0]);
}

export async function getComment(id: number): Promise<Comment | null> {
  if (!isDbConfigured()) return null;
  const sql = await db();
  const rows = await sql`SELECT * FROM comments WHERE id = ${id}`;
  return rows.length ? toComment(rows[0]) : null;
}

export async function setCommentResolved(
  id: number,
  resolved: boolean,
  by: string,
): Promise<Comment | null> {
  const sql = await db();
  const rows = await sql`
    UPDATE comments
    SET resolved = ${resolved}, resolved_by = ${resolved ? by : null}
    WHERE id = ${id}
    RETURNING *
  `;
  return rows.length ? toComment(rows[0]) : null;
}

/** Replies cascade via the FK, so a deleted thread takes its replies with it. */
export async function deleteComment(id: number): Promise<void> {
  const sql = await db();
  await sql`DELETE FROM comments WHERE id = ${id}`;
}

/* ----------------------------- proposals ------------------------------ */

export async function listProposals(): Promise<Proposal[]> {
  if (!isDbConfigured()) return [];
  const sql = await db();
  // Open first, then newest — the owner's queue is what this page is for.
  const rows = await sql`
    SELECT p.id, p.title, p.body, p.status, p.author_login, p.author_avatar,
           p.base_version_id, p.merged_version_id, p.resolution_note,
           p.resolved_by, p.resolved_at, p.created_at,
           (SELECT count(*) FROM comments c WHERE c.proposal_id = p.id) AS comment_count
    FROM proposals p
    WHERE p.api_id = ${API_ID}
    ORDER BY (p.status = 'open') DESC, p.id DESC
  `;
  return rows.map(toProposal);
}

export async function getProposal(id: number): Promise<Proposal | null> {
  if (!isDbConfigured()) return null;
  const sql = await db();
  const rows = await sql`SELECT * FROM proposals WHERE id = ${id} AND api_id = ${API_ID}`;
  return rows.length ? toProposal(rows[0]) : null;
}

export async function createProposal(input: {
  title: string;
  body: string;
  yaml: string;
  baseVersionId: number | null;
  author: Viewer;
}): Promise<Proposal> {
  const sql = await db();
  const rows = await sql`
    INSERT INTO proposals (api_id, title, body, yaml, base_version_id, author_login, author_avatar)
    VALUES (
      ${API_ID},
      ${input.title},
      ${input.body},
      ${input.yaml},
      ${input.baseVersionId},
      ${input.author.login},
      ${input.author.avatar}
    )
    RETURNING *
  `;
  return toProposal(rows[0]);
}

/**
 * Closes a proposal.
 *
 * The `status = 'open'` predicate makes this a compare-and-set: a second
 * approval racing the first updates zero rows and returns null, so the same
 * proposal cannot be merged twice into two versions.
 */
export async function resolveProposal(input: {
  id: number;
  status: Exclude<ProposalStatus, 'open'>;
  by: string;
  note: string;
  mergedVersionId?: number | null;
}): Promise<Proposal | null> {
  const sql = await db();
  const rows = await sql`
    UPDATE proposals
    SET status = ${input.status},
        resolved_by = ${input.by},
        resolved_at = now(),
        resolution_note = ${input.note},
        merged_version_id = ${input.mergedVersionId ?? null}
    WHERE id = ${input.id} AND api_id = ${API_ID} AND status = 'open'
    RETURNING *
  `;
  return rows.length ? toProposal(rows[0]) : null;
}

/**
 * Approves an edit request: publishes its YAML as a new version and closes the
 * proposal, in one statement.
 *
 * Deliberately a single CTE rather than three calls. The neon HTTP driver runs
 * each statement in its own implicit transaction, so splitting this up would
 * leave a window where the contract had already changed but the proposal still
 * read `open` — or worse, a spec_versions row with no proposal pointing at it.
 * `FOR UPDATE` plus the `status = 'open'` predicate makes a second, concurrent
 * approval a no-op that returns null instead of publishing the same change
 * twice.
 *
 * Returns null when the proposal is missing or is no longer open.
 */
export async function mergeProposal(input: {
  id: number;
  by: Viewer;
  note: string;
  message: string;
}): Promise<{ proposal: Proposal; versionId: number | null } | null> {
  const sql = await db();
  const rows = await sql`
    WITH src AS (
      SELECT id, yaml FROM proposals
      WHERE id = ${input.id} AND api_id = ${API_ID} AND status = 'open'
      FOR UPDATE
    ),
    published AS (
      INSERT INTO spec_versions (api_id, yaml, message, author_login, author_avatar, from_proposal)
      SELECT ${API_ID}, src.yaml, ${input.message}, ${input.by.login}, ${input.by.avatar}, src.id
      FROM src
      RETURNING id
    )
    UPDATE proposals p
    SET status = 'merged',
        resolved_by = ${input.by.login},
        resolved_at = now(),
        resolution_note = ${input.note},
        merged_version_id = (SELECT id FROM published)
    FROM src
    WHERE p.id = src.id AND p.status = 'open'
    RETURNING p.id, p.title, p.body, p.status, p.author_login, p.author_avatar,
              p.base_version_id, p.merged_version_id, p.resolution_note,
              p.resolved_by, p.resolved_at, p.created_at
  `;

  if (!rows.length) return null;
  const proposal = toProposal(rows[0]);
  return { proposal, versionId: proposal.mergedVersionId };
}
