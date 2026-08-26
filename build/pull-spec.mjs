#!/usr/bin/env node
/**
 * Pulls every contract back out of the hosted app and into the repo.
 *
 * The README says OpenAPI is the source of truth. Once edits start happening
 * in the browser that stops being true unless someone syncs it back — the
 * deployment's Postgres becomes a second, diverging copy, and the committed
 * docs/ HTML goes stale.
 *
 * The app serves and edits ONE bundled document per spec, while the repo
 * keeps each contract split across many files. So pulling is
 * fetch-then-re-split per spec: the bundle comes down and
 * build/split-spec.mjs explodes it back into that spec's layout. The split is
 * idempotent, so re-running produces no spurious churn.
 *
 * So: edit in the browser, then run this, then `npm run build`, then commit.
 *
 *   npm run pull                        # uses CONTRACTS_URL, all specs
 *   npm run pull -- https://host        # or pass the deployment explicitly
 *
 * Reads only the public GET /api/specs/<slug>, so no credentials are involved.
 *
 * Every spec in redocly.yaml's `apis:` map is attempted, even if an earlier
 * one fails — a network blip on one spec must not look like a clean success
 * for the whole run, and must not silently skip the others either.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const base = (process.argv[2] || process.env.CONTRACTS_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('usage: node build/pull-spec.mjs <deployment-url>');
  console.error('   or: set CONTRACTS_URL=https://<your-app>.vercel.app');
  process.exit(1);
}

const redoclyConfig = parse(readFileSync(resolve(repo, 'redocly.yaml'), 'utf8'));
const slugs = Object.keys(redoclyConfig.apis ?? {});
if (!slugs.length) {
  console.error('pull-spec: no entries under `apis:` in redocly.yaml.');
  process.exit(1);
}

async function pullOne(slug) {
  const target = resolve(repo, 'dist', `${slug}.openapi.yaml`);
  const url = `${base}/api/specs/${slug}`;
  console.log(`pulling ${url}`);

  const response = await fetch(url, { headers: { accept: 'application/yaml' } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);

  const yaml = await response.text();
  const version = response.headers.get('x-spec-version') ?? 'unknown';

  // Two sanity checks before overwriting a tracked file: a login page or an
  // error body would otherwise be written straight over the contract.
  if (!yaml.trimStart().startsWith('openapi:')) {
    throw new Error(`response for ${slug} does not look like an OpenAPI document — first line: ${yaml.split('\n')[0]?.slice(0, 120)}`);
  }
  if (yaml.length < 1000) {
    throw new Error(`response for ${slug} is only ${yaml.length} bytes — refusing to overwrite`);
  }

  const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (before === yaml) {
    console.log(`${slug}: already up to date (hosted version ${version}).`);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, yaml);
  console.log(`${slug}: fetched hosted version ${version} (${Math.round(yaml.length / 1024)} KiB)`);

  // Explode it back over that spec's split sources, so the change lands as a
  // diff on the files it actually touches rather than one enormous hunk.
  execFileSync(process.execPath, [resolve(here, 'split-spec.mjs'), target, slug], {
    cwd: repo,
    stdio: 'inherit',
  });
}

const failures = [];
for (const slug of slugs) {
  try {
    await pullOne(slug);
  } catch (err) {
    failures.push(slug);
    console.error(`pull-spec: ${slug} failed: ${err instanceof Error ? err.message : err}`);
  }
}

console.log();
if (failures.length) {
  console.error(`pull-spec: ${failures.length}/${slugs.length} spec(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('next: npm run build, then commit the changed spec directories, shared/ and docs/.');
console.log('      `git diff --stat` shows what the change touched.');
