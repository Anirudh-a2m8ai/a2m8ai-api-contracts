#!/usr/bin/env node
/**
 * Empties the comments, edit requests and version history for every spec, so
 * the next request re-seeds each one from the contract committed in the repo.
 *
 *   npm run reset -- --yes
 *
 * For clearing out test data while you are trying the app. It does not touch
 * the `specs` registry row itself (that's code-managed, reseeded by
 * ensureSchema()) or any spec's source files — those are the things it
 * resets *to*.
 *
 * `--yes` is required rather than a prompt, because this is destructive and
 * runs against whatever DATABASE_URL happens to be set. It prints what it is
 * about to delete first, and names the host, so a misaimed run is visible
 * before it is irreversible.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env.local');

// Vercel injects POSTGRES_URL; .env.local is the local convention.
let url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!url && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const at = trimmed.indexOf('=');
    const key = trimmed.slice(0, at).trim();
    if (key === 'DATABASE_URL' || key === 'POSTGRES_URL') url = trimmed.slice(at + 1).trim();
  }
}

if (!url) {
  console.error('No DATABASE_URL or POSTGRES_URL found in the environment or web/.env.local.');
  process.exit(1);
}

const sql = neon(url);
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return 'the configured database';
  }
})();

const counts = await sql`
  SELECT
    (SELECT count(*) FROM spec_versions) AS versions,
    (SELECT count(*) FROM proposals)     AS proposals,
    (SELECT count(*) FROM comments)      AS comments
`.catch(() => null);

if (!counts) {
  console.log(`Nothing to reset on ${host} — the tables do not exist yet.`);
  process.exit(0);
}

const { versions, proposals, comments } = counts[0];
console.log(`\n${host}`);
console.log(`  ${versions} version(s), ${proposals} edit request(s), ${comments} comment(s)`);

if (!process.argv.includes('--yes')) {
  console.log('\nThis would delete all of the above. Rerun with --yes to go ahead:');
  console.log('  npm run reset -- --yes\n');
  process.exit(1);
}

// CASCADE because comments reference proposals and proposals reference
// versions; RESTART IDENTITY so the reseeded contract is version 1 again
// rather than continuing the old sequence.
await sql`TRUNCATE comments, proposals, spec_versions RESTART IDENTITY CASCADE`;

console.log('\nCleared. The next page load reseeds version 1 for each spec from its committed contract.\n');
