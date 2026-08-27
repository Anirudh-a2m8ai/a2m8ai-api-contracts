#!/usr/bin/env node
/**
 * Embeds every BUNDLED contract into the Next bundle as
 * src/generated/seed-spec.ts.
 *
 * Why not just read the files at runtime: on Vercel the app is deployed from
 * the `web/` root directory, so `../dist/<slug>.openapi.yaml` is not in the
 * serverless bundle. Embedding them as a module guarantees three things:
 *
 *   1. The docs render even before a database is attached (read-only fallback).
 *   2. A fresh database seeds each spec with its committed contract as
 *      version 1, so the deploy is never staring at an empty spec.
 *   3. The YAML is stored via JSON.stringify, so backticks and ${...} inside
 *      a spec's markdown descriptions cannot break out of the literal.
 *
 * It reads dist/<slug>.openapi.yaml, not <slug>/openapi.yaml, because each
 * source is split across many files that reference each other by relative
 * path (including into shared/). The app hands one YAML string per spec to
 * the browser, and a browser cannot follow a `$ref: ../../shared/components/
 * schemas/ErrorResponse.yaml`. So the bundle, which has every $ref resolved
 * back into a single document, is the only shape that can be served. Run
 * `npm run bundle` at the repo root to refresh it.
 *
 * The set of specs to embed is discovered from redocly.yaml's `apis:` map —
 * one registry, not a second hardcoded list — mirroring build/pull-spec.mjs.
 * A spec whose dist/ bundle is missing at build time falls back to whatever
 * is already committed for that slug, independently of the others.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const outFile = resolve(here, '..', 'src', 'generated', 'seed-spec.ts');

const redoclyConfig = parse(readFileSync(resolve(repoRoot, 'redocly.yaml'), 'utf8'));
const slugs = Object.keys(redoclyConfig.apis ?? {});

// Existing committed entries, so a missing dist/ bundle for one slug falls
// back to what's already there instead of dropping that spec entirely.
let existing = {};
if (existsSync(outFile)) {
  const match = readFileSync(outFile, 'utf8').match(/SEED_SPECS[^=]*=\s*(\{[\s\S]*?\n\});/);
  if (match) {
    try {
      // The generated object literal is JSON-safe (string/number values only).
      existing = JSON.parse(match[1].replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      existing = {};
    }
  }
}

const entries = {};
for (const slug of slugs) {
  const source = resolve(repoRoot, 'dist', `${slug}.openapi.yaml`);
  if (!existsSync(source)) {
    if (existing[slug]) {
      console.log(`embed-spec: no dist/${slug}.openapi.yaml in this build; keeping the committed entry.`);
      entries[slug] = existing[slug];
    } else {
      console.error(`embed-spec: bundle not found at ${source} and no committed entry to fall back on.`);
      console.error('Run `npm run bundle` at the repo root first.');
      process.exit(1);
    }
    continue;
  }
  const yaml = readFileSync(source, 'utf8');
  entries[slug] = { yaml, bytes: Buffer.byteLength(yaml) };
  console.log(`embed-spec: dist/${slug}.openapi.yaml -> seed-spec.ts (${Math.round(Buffer.byteLength(yaml) / 1024)} KiB)`);
}

// Keys are quoted so this object literal is also valid JSON — the "existing
// entries" fallback above parses it with JSON.parse rather than a JS eval.
const body = Object.entries(entries)
  .map(
    ([slug, { yaml, bytes }]) =>
      `  ${JSON.stringify(slug)}: { "yaml": ${JSON.stringify(yaml)}, "bytes": ${bytes} },`,
  )
  .join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  '// GENERATED FILE — do not edit. Committed on purpose: it is the seed a\n' +
    '// fresh deployment adopts as version 1 for each spec, and the fallback\n' +
    '// when a bundle is not in the build. See web/.gitignore for why.\n' +
    '//\n' +
    '// Written by web/scripts/embed-spec.mjs from dist/<slug>.openapi.yaml,\n' +
    '// which `npm run bundle` produces from the split sources at the repo root.\n' +
    '// Refresh with `npm run build` at the repo root.\n\n' +
    `export const SEED_SPECS: Record<string, { yaml: string; bytes: number }> = {\n${body}\n};\n`,
);

console.log(`embed-spec: wrote seed-spec.ts with ${Object.keys(entries).length} spec(s).`);
