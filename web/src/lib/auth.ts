import { cookies } from 'next/headers';
import { SESSION_COOKIE, decodeSession } from './session';
import { GUEST, type Viewer } from './types';

/**
 * Authorisation. Three roles, and the boundary between them is enforced here
 * and re-checked inside every mutating route — never in the UI alone. The
 * client hides buttons it should not offer, but hiding a button is a courtesy,
 * not a control.
 *
 *   owner       the single GitHub account named by OWNER_GITHUB_LOGIN.
 *               Edits the contract directly; merges or rejects proposals;
 *               resolves and deletes comments.
 *   contributor any other signed-in GitHub account.
 *               Comments and opens edit requests. Cannot change the contract.
 *   guest       signed out. Reads the contract, comments and proposals.
 */

/** Fails closed: with OWNER_GITHUB_LOGIN unset, nobody is the owner. */
export function isOwnerLogin(login: string | null | undefined): boolean {
  const owner = process.env.OWNER_GITHUB_LOGIN?.trim();
  if (!owner || !login) return false;
  // GitHub treats logins case-insensitively; "Anirudh" and "anirudh" are one
  // account, and the profile casing can differ from what is in the env var.
  return owner.toLowerCase() === login.trim().toLowerCase();
}

export async function getViewer(): Promise<Viewer> {
  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return GUEST;

  return {
    login: session.login,
    name: session.name,
    avatar: session.avatar,
    role: isOwnerLogin(session.login) ? 'owner' : 'contributor',
  };
}

/** Raised by the require* helpers; mapped to a status code by `guard`. */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Signed in as anyone. Enough to comment or open an edit request. */
export async function requireContributor(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer.role === 'guest') {
    throw new AuthError(401, 'Sign in with GitHub to do that.');
  }
  return viewer;
}

/** Signed in as the owner. Required for anything that changes the contract. */
export async function requireOwner(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer.role === 'guest') {
    throw new AuthError(401, 'Sign in with GitHub to do that.');
  }
  if (viewer.role !== 'owner') {
    throw new AuthError(
      403,
      'Only the contract owner can change the contract directly. Open an edit request instead.',
    );
  }
  return viewer;
}

/**
 * Wraps a route handler so AuthError and a missing database become clean JSON
 * instead of a 500 with a stack trace.
 */
export async function guard(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    // A write with no Storage attached is a deployment gap, not a bug — 503
    // tells the client to show the setup hint rather than "something broke".
    const isSetup = message.includes('No database is attached') || message.includes('SESSION_SECRET');
    if (!isSetup) console.error('[api]', err);
    return Response.json({ error: message }, { status: isSetup ? 503 : 500 });
  }
}
