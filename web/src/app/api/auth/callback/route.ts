import { NextResponse } from 'next/server';
import { appOrigin, exchangeCodeForToken, fetchProfile } from '@/lib/github';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  encodeSession,
  readOAuthState,
} from '@/lib/session';

/** Where GitHub sends the browser back. Exchanges the code for a session. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOrigin(request);

  const fail = (reason: string) => {
    const response = NextResponse.redirect(`${origin}/?error=${encodeURIComponent(reason)}`);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  };

  const denied = url.searchParams.get('error');
  if (denied) return fail(denied === 'access_denied' ? 'sign-in-cancelled' : denied);

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code || !returnedState) return fail('missing-code');

  // CSRF check: the state must match the cookie we set on the way out, byte for
  // byte, and must carry our own signature.
  const cookieState = request.headers
    .get('cookie')
    ?.split('; ')
    .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);

  if (!cookieState || cookieState !== returnedState) return fail('state-mismatch');

  const state = readOAuthState(returnedState);
  if (!state) return fail('state-invalid');

  let profile;
  try {
    const token = await exchangeCodeForToken(origin, code);
    profile = await fetchProfile(token);
    // The token is not persisted anywhere. It bought us a username and an
    // avatar; keeping it would give a stolen cookie reach into GitHub.
  } catch (err) {
    console.error('[auth] GitHub sign-in failed', err);
    return fail('github-error');
  }

  if (!profile.login) return fail('no-profile');

  const session = encodeSession({
    login: profile.login,
    name: profile.name ?? null,
    avatar: profile.avatar_url ?? null,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  });

  const response = NextResponse.redirect(`${origin}${state.returnTo}`);
  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
