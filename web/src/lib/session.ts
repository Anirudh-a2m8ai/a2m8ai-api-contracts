import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Stateless sessions: a JSON payload plus an HMAC, in an httpOnly cookie.
 *
 * No session table, because there is nothing worth storing server-side — the
 * payload is a GitHub login and an avatar URL. The GitHub access token is
 * deliberately NOT kept: it is used once during the callback to read the
 * profile and then discarded, so a leaked cookie cannot act on GitHub.
 */

export const SESSION_COOKIE = 'a2m8_session';
export const OAUTH_STATE_COOKIE = 'a2m8_oauth_state';

/** Seven days. Long enough not to nag, short enough that revocation lands. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  login: string;
  name: string | null;
  avatar: string | null;
  /** Expiry, seconds since epoch. */
  exp: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error(
      'SESSION_SECRET is not set. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return value;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function encodeSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything malformed, mis-signed or expired — never throws. */
export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), 'base64url');

  let expected: Buffer;
  try {
    expected = Buffer.from(sign(body), 'base64url');
  } catch {
    return null; // SESSION_SECRET missing — treat as signed out.
  }

  // Length check first: timingSafeEqual throws on a mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.login !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** CSRF token for the OAuth round trip, signed the same way. */
export function newOAuthState(returnTo: string): string {
  const nonce = randomBytes(16).toString('hex');
  const body = b64url(JSON.stringify({ nonce, returnTo }));
  return `${body}.${sign(body)}`;
}

export function readOAuthState(
  token: string | undefined,
): { nonce: string; returnTo: string } | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), 'base64url');

  let expected: Buffer;
  try {
    expected = Buffer.from(sign(body), 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
