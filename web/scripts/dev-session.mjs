#!/usr/bin/env node
/**
 * Mints a signed session cookie for local testing, so you can try the app as
 * the owner and as a contributor without registering a GitHub OAuth app.
 *
 *   node scripts/dev-session.mjs            # sign in as OWNER_GITHUB_LOGIN
 *   node scripts/dev-session.mjs some-dev   # sign in as a contributor
 *
 * It prints a one-liner to paste into the browser console. That is the whole
 * mechanism — there is no dev bypass in the server. The cookie is a real one,
 * signed with SESSION_SECRET from .env.local, and the server checks it exactly
 * as it checks a cookie issued by the GitHub flow. Anyone who can run this
 * already has the signing secret, so it grants nothing they did not have.
 *
 * Nothing here is imported by the app; it cannot run on Vercel.
 */

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env.local');

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

const secret = env.SESSION_SECRET;
if (!secret) {
  console.error('SESSION_SECRET is not set in web/.env.local. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const owner = env.OWNER_GITHUB_LOGIN?.trim();
const login = process.argv[2]?.trim() || owner;

if (!login) {
  console.error('No login given and OWNER_GITHUB_LOGIN is not set in web/.env.local.');
  console.error('usage: node scripts/dev-session.mjs [github-login]');
  process.exit(1);
}

const payload = {
  login,
  name: login,
  avatar: null,
  exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // a day is plenty for a test
};

const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signature = createHmac('sha256', secret).update(body).digest('base64url');
const cookie = `${body}.${signature}`;

const isOwner = Boolean(owner) && owner.toLowerCase() === login.toLowerCase();

console.log(`\nSigned in as: ${login}`);
console.log(
  `Role:         ${isOwner ? 'owner — can publish, approve and reject' : 'contributor — can comment and propose, cannot publish'}`,
);
if (!isOwner && owner) console.log(`              (the owner is ${owner})`);
console.log('\nPaste this into the browser console on http://localhost:3000, then reload:\n');
console.log(`document.cookie = 'a2m8_session=${cookie}; path=/'\n`);
console.log("To sign out again:\n");
console.log("document.cookie = 'a2m8_session=; path=/; max-age=0'\n");
