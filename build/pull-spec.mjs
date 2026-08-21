#!/usr/bin/env node
/**
 * Pulls the contract back out of the hosted app and into the repo.
 *
 * The README says OpenAPI is the source of truth and lives in
 * ai-service/openapi.yaml. Once edits start happening in the browser that
 * stops being true unless someone syncs it back — the deployment's Postgres
 * becomes a second, diverging copy, and the committed docs/ HTML goes stale.
 *
 * So: edit in the browser, then run this, then `npm run build`, then commit.
 * That keeps the repo authoritative for codegen and offline reading while the
 * hosted app stays the place where changes are proposed and reviewed.
 *
 *   npm run pull                        # uses CONTRACTS_URL
 *   npm run pull -- https://host        # or pass the deployment explicitly
 *
 * Reads only the public GET /api/spec, so no credentials are involved.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '..', 'ai-service', 'openapi.yaml');

const base = (process.argv[2] || process.env.CONTRACTS_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('usage: node build/pull-spec.mjs <deployment-url>');
  console.error('   or: set CONTRACTS_URL=https://<your-app>.vercel.app');
  process.exit(1);
}

const url = `${base}/api/spec`;
console.log(`pulling ${url}`);

let response;
try {
  response = await fetch(url, { headers: { accept: 'application/yaml' } });
} catch (err) {
  console.error(`could not reach ${url}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

if (!response.ok) {
  console.error(`${url} returned HTTP ${response.status}`);
  process.exit(1);
}

const yaml = await response.text();
const version = response.headers.get('x-spec-version') ?? 'unknown';

// Two sanity checks before overwriting a tracked file: a login page or an
// error body would otherwise be written straight over the contract.
if (!yaml.trimStart().startsWith('openapi:')) {
  console.error('the response does not look like an OpenAPI document — refusing to overwrite.');
  console.error(`first line: ${yaml.split('\n')[0]?.slice(0, 120)}`);
  process.exit(1);
}
if (yaml.length < 1000) {
  console.error(`the response is only ${yaml.length} bytes — refusing to overwrite.`);
  process.exit(1);
}

const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
if (before === yaml) {
  console.log(`already up to date (hosted version ${version}).`);
  process.exit(0);
}

writeFileSync(target, yaml);

const lines = (text) => text.split('\n').length;
console.log(
  `wrote ai-service/openapi.yaml from hosted version ${version} ` +
    `(${lines(before)} -> ${lines(yaml)} lines)`,
);
console.log('next: npm run build, then commit ai-service/ and docs/.');
