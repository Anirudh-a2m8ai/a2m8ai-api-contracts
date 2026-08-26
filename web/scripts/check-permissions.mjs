#!/usr/bin/env node
/**
 * Asserts the permission boundary over real HTTP against a running server.
 *
 *   npm run check                       # against http://localhost:3000
 *   npm run check -- https://your.app   # or a deployment
 *   npm run check -- --write            # also exercise the writes, then undo them
 *
 * The sessions here are minted with the same SESSION_SECRET the server uses,
 * so these are genuine signed cookies rather than stubs. That is the point:
 * the assertion worth making is not "a stranger is refused" but "a validly
 * signed, genuinely signed-in contributor is still refused".
 *
 * NON-DESTRUCTIVE by default, deliberately — it is meant to be safe to point
 * at the real deployment. In particular the owner check round-trips the
 * contract that is already published rather than sending a stub, so proving
 * that the owner gets through cannot cost you a version. `--write` adds the
 * positive write cases, each of which cleans up after itself.
 *
 * Every route now takes a spec slug (/api/specs/:spec/...) since the app
 * hosts more than one contract. This script exercises the boundary against
 * one spec (course-outline) — the auth check itself is spec-agnostic
 * (web/src/lib/auth.ts), so there is nothing to learn from repeating every
 * assertion against the second spec too.
 *
 * Run it after touching src/lib/auth.ts or anything under src/app/api.
 */

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env.local');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const BASE = (args.find((a) => !a.startsWith('--')) || 'http://localhost:3000').replace(/\/+$/, '');
const SPEC = 'course-outline';

if (!existsSync(envFile)) {
  console.error('web/.env.local not found. Copy web/.env.example to web/.env.local first.');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const SECRET = env.SESSION_SECRET;
const OWNER = env.OWNER_GITHUB_LOGIN;
if (!SECRET || !OWNER) {
  console.error('SESSION_SECRET and OWNER_GITHUB_LOGIN must both be set in web/.env.local.');
  process.exit(1);
}

function cookieFor(login, { secret = SECRET, ttl = 3600 } = {}) {
  const body = Buffer.from(
    JSON.stringify({ login, name: login, avatar: null, exp: Math.floor(Date.now() / 1000) + ttl }),
  ).toString('base64url');
  return `a2m8_session=${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const CONTRIBUTOR = cookieFor('some-ai-dev');
const OWNER_COOKIE = cookieFor(OWNER);
const OWNER_ODD_CASE = cookieFor(OWNER.toUpperCase());
const FORGED = cookieFor(OWNER, { secret: 'not-the-real-secret' });
const EXPIRED = cookieFor(OWNER, { ttl: -60 });

const STUB_SPEC = 'openapi: 3.1.0\ninfo:\n  title: x\n  version: 1\npaths: {}\n';

let failures = 0;
let noDbSeen = false;

async function call({ method = 'GET', path, cookie, body }) {
  return fetch(BASE + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
}

async function expect(name, request, wanted) {
  let response;
  try {
    response = await call(request);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${name} — could not reach ${BASE}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  // 503 means the route authorised the caller and then found no database.
  // That still proves the boundary; it just cannot prove the write landed.
  if (response.status === 503) noDbSeen = true;

  const list = Array.isArray(wanted) ? wanted : [wanted];
  const ok = list.includes(response.status);
  if (!ok) {
    failures += 1;
    const text = await response.clone().text();
    console.log(`  FAIL  ${name} — got ${response.status}, wanted ${list.join(' or ')}: ${text.slice(0, 160)}`);
  } else {
    console.log(`  PASS  ${name}`);
  }
  return response;
}

console.log(`\nchecking ${BASE} (spec: ${SPEC})${WRITE ? '  (--write: writes will be made and then undone)' : ''}\n`);

console.log('reading is open to everyone');
await expect('guest reads the contract', { path: `/api/specs/${SPEC}` }, 200);
await expect('guest reads it as JSON', { path: `/api/specs/${SPEC}?format=json` }, 200);
await expect('guest reads comments', { path: `/api/specs/${SPEC}/comments` }, [200, 503]);
await expect('guest reads edit requests', { path: `/api/specs/${SPEC}/proposals` }, [200, 503]);
await expect('guest reads version history', { path: `/api/specs/${SPEC}/versions` }, [200, 503]);
await expect('an unknown spec 404s', { path: '/api/specs/not-a-real-spec' }, 404);
await expect('guest loads the landing page', { path: '/' }, 200);
await expect('guest loads the reference', { path: `/${SPEC}` }, 200);
await expect('guest loads the editor', { path: `/${SPEC}/editor` }, 200);

console.log('\nonly the owner may change the contract');
// Everyone below the owner is refused before the body is looked at at all, so
// the stub here can never land.
const stubEdit = { yaml: STUB_SPEC, message: 'must not land' };
await expect('guest is refused', { method: 'PUT', path: `/api/specs/${SPEC}`, body: stubEdit }, 401);
await expect(
  'signed-in contributor is refused',
  { method: 'PUT', path: `/api/specs/${SPEC}`, cookie: CONTRIBUTOR, body: stubEdit },
  403,
);
await expect(
  'forged owner cookie is refused',
  { method: 'PUT', path: `/api/specs/${SPEC}`, cookie: FORGED, body: stubEdit },
  401,
);
await expect(
  'expired owner cookie is refused',
  { method: 'PUT', path: `/api/specs/${SPEC}`, cookie: EXPIRED, body: stubEdit },
  401,
);

// The owner WOULD be let through, so hand back exactly what is already
// published. The route's no-op guard answers `unchanged` without inserting a
// version: the boundary is proven and nothing is written.
const publishedYaml = await (await call({ path: `/api/specs/${SPEC}` })).text();
const roundTrip = { yaml: publishedYaml, message: 'permission check round-trip' };
const ownerResponse = await expect(
  'owner is let through (round-trips the published contract)',
  { method: 'PUT', path: `/api/specs/${SPEC}`, cookie: OWNER_COOKIE, body: roundTrip },
  [200, 503],
);
if (ownerResponse?.status === 200) {
  const data = await ownerResponse.clone().json().catch(() => ({}));
  const unchanged = data.unchanged === true;
  if (!unchanged) failures += 1;
  console.log(`  ${unchanged ? 'PASS' : 'FAIL'}  ...and the round-trip published nothing`);
}
await expect(
  'owner login matches case-insensitively',
  { method: 'PUT', path: `/api/specs/${SPEC}`, cookie: OWNER_ODD_CASE, body: roundTrip },
  [200, 503],
);

console.log('\nonly the owner may decide an edit request');
await expect(
  'guest cannot approve',
  { method: 'PATCH', path: `/api/specs/${SPEC}/proposals/1`, body: { action: 'approve' } },
  [401, 404, 503],
);
await expect(
  'contributor cannot approve',
  { method: 'PATCH', path: `/api/specs/${SPEC}/proposals/1`, cookie: CONTRIBUTOR, body: { action: 'approve' } },
  [403, 404, 503],
);

console.log('\ncommenting needs a sign-in, nothing more');
await expect(
  'guest cannot comment',
  { method: 'POST', path: `/api/specs/${SPEC}/comments`, body: { anchor: 'info', body: 'hi' } },
  401,
);
// An empty body is rejected at validation, which is past the auth gate — a 400
// here rather than a 401/403 is what proves a contributor may comment.
await expect(
  'contributor reaches validation, not a 403',
  { method: 'POST', path: `/api/specs/${SPEC}/comments`, cookie: CONTRIBUTOR, body: { anchor: 'info', body: '   ' } },
  400,
);
await expect(
  'a bogus anchor is rejected',
  {
    method: 'POST',
    path: `/api/specs/${SPEC}/comments`,
    cookie: CONTRIBUTOR,
    body: { anchor: 'javascript:alert(1)', body: 'x' },
  },
  400,
);

console.log('\nopening an edit request needs a sign-in, nothing more');
await expect(
  'guest cannot open one',
  { method: 'POST', path: `/api/specs/${SPEC}/proposals`, body: { title: 't', yaml: STUB_SPEC } },
  401,
);
await expect(
  'contributor reaches validation, not a 403',
  { method: 'POST', path: `/api/specs/${SPEC}/proposals`, cookie: CONTRIBUTOR, body: { title: '  ', yaml: STUB_SPEC } },
  400,
);
await expect(
  'broken YAML never reaches storage',
  { method: 'POST', path: `/api/specs/${SPEC}/proposals`, cookie: CONTRIBUTOR, body: { title: 't', yaml: 'a: b: c: d:' } },
  422,
);
await expect(
  'a spec with no paths is rejected',
  {
    method: 'POST',
    path: `/api/specs/${SPEC}/proposals`,
    cookie: CONTRIBUTOR,
    body: { title: 't', yaml: 'openapi: 3.1.0\ninfo:\n  title: x\n  version: 1\n' },
  },
  422,
);

console.log('\nsign-out is POST-only, and sign-in is not an open redirect');
await expect('GET /api/auth/logout is not a route', { path: '/api/auth/logout' }, 405);
const login = await expect(
  'sign-in redirects',
  { path: '/api/auth/login?returnTo=https://evil.example/steal' },
  [302, 307],
);
if (login) {
  const location = login.headers.get('location') ?? '';
  const leaked = location.includes('evil.example');
  if (leaked) failures += 1;
  console.log(`  ${leaked ? 'FAIL' : 'PASS'}  an off-site returnTo is not honoured`);
}

if (WRITE) {
  console.log('\nwrites (each undone afterwards)');

  const created = await expect(
    'contributor can actually post a comment',
    {
      method: 'POST',
      path: `/api/specs/${SPEC}/comments`,
      cookie: CONTRIBUTOR,
      body: { anchor: 'info', anchorLabel: 'Overview', body: 'permission check — safe to ignore' },
    },
    201,
  );
  if (created?.ok) {
    const { comment } = await created.json();
    await expect(
      'a contributor cannot resolve their own thread',
      {
        method: 'PATCH',
        path: `/api/specs/${SPEC}/comments/${comment.id}`,
        cookie: CONTRIBUTOR,
        body: { resolved: true },
      },
      403,
    );
    await expect(
      'the owner can resolve it',
      {
        method: 'PATCH',
        path: `/api/specs/${SPEC}/comments/${comment.id}`,
        cookie: OWNER_COOKIE,
        body: { resolved: true },
      },
      200,
    );
    await expect(
      'the author can delete their own comment',
      { method: 'DELETE', path: `/api/specs/${SPEC}/comments/${comment.id}`, cookie: CONTRIBUTOR },
      200,
    );
  }

  const opened = await expect(
    'contributor can actually open an edit request',
    {
      method: 'POST',
      path: `/api/specs/${SPEC}/proposals`,
      cookie: CONTRIBUTOR,
      body: {
        title: 'permission check — safe to ignore',
        body: 'Opened by npm run check --write, withdrawn immediately.',
        yaml: publishedYaml + '\n# permission check\n',
      },
    },
    201,
  );
  if (opened?.ok) {
    const { proposal } = await opened.json();
    await expect(
      'a contributor cannot approve their own request',
      {
        method: 'PATCH',
        path: `/api/specs/${SPEC}/proposals/${proposal.id}`,
        cookie: CONTRIBUTOR,
        body: { action: 'approve' },
      },
      403,
    );
    await expect(
      'the author can withdraw it',
      {
        method: 'PATCH',
        path: `/api/specs/${SPEC}/proposals/${proposal.id}`,
        cookie: CONTRIBUTOR,
        body: { action: 'withdraw', note: 'permission check cleanup' },
      },
      200,
    );
    await expect(
      'a withdrawn request cannot then be approved',
      {
        method: 'PATCH',
        path: `/api/specs/${SPEC}/proposals/${proposal.id}`,
        cookie: OWNER_COOKIE,
        body: { action: 'approve' },
      },
      409,
    );
    console.log(`  note  edit request #${proposal.id} is left withdrawn — closed, and harmless.`);
  }
}

if (noDbSeen) {
  console.log(
    '\nnote: some routes answered 503 (no database attached). The permission checks above still\n' +
      '      hold — 503 means the caller was authorised and then found nowhere to write. Set\n' +
      '      DATABASE_URL and rerun with --write to also exercise the writes.',
  );
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
