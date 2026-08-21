/** The GitHub OAuth web flow. Identity only — we ask for no repository scope. */

export interface GitHubProfile {
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export function oauthConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

/**
 * The origin to hand GitHub as redirect_uri.
 *
 * APP_URL wins when set, because an OAuth app accepts exactly one callback URL
 * and Vercel preview deployments each get their own hostname — without pinning,
 * every preview would fail the redirect_uri check.
 */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

export function authorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/callback`,
    // read:user, not user:email — we want a handle and an avatar, nothing more.
    scope: 'read:user',
    state,
    allow_signup: 'false',
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(origin: string, code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/api/auth/callback`,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed with HTTP ${response.status}`);
  }

  // GitHub answers 200 with an { error } body on a bad code, not a 4xx.
  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(data.error_description || 'GitHub did not return an access token');
  }
  return data.access_token;
}

export async function fetchProfile(token: string): Promise<GitHubProfile> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'a2m8-api-contracts',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Could not read GitHub profile (HTTP ${response.status})`);
  }
  return (await response.json()) as GitHubProfile;
}
