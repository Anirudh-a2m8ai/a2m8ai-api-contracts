import { NextResponse } from 'next/server';
import { appOrigin, authorizeUrl, oauthConfigured } from '@/lib/github';
import { OAUTH_STATE_COOKIE, newOAuthState } from '@/lib/session';

/** Starts the GitHub OAuth web flow. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOrigin(request);

  if (!oauthConfigured()) {
    return NextResponse.redirect(`${origin}/?error=oauth-not-configured`);
  }

  // Only same-site paths, so `?returnTo=https://evil.example` cannot turn the
  // sign-in link into an open redirect.
  const requested = url.searchParams.get('returnTo') ?? '/';
  const returnTo = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const state = newOAuthState(returnTo);
  const response = NextResponse.redirect(authorizeUrl(origin, state));

  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 'lax' rather than 'strict': the browser arrives back from github.com on a
    // top-level GET, and a strict cookie would not be sent on that navigation.
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  return response;
}
