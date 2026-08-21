#!/usr/bin/env node
/**
 * Embeds ai-service/openapi.yaml into the Next bundle as src/generated/seed-spec.ts.
 *
 * Why not just read the file at runtime: on Vercel the app is deployed from the
 * `web/` root directory, so `../ai-service/openapi.yaml` is not in the serverless
 * bundle. Embedding it as a module guarantees three things:
 *
 *   1. The docs render even before a database is attached (read-only fallback).
 *   2. A fresh database seeds itself with the committed contract as version 1,
 *      so the deploy is never staring at an empty spec.
 *   3. The YAML is stored via JSON.stringify, so backticks and ${...} inside
 *      the spec's markdown descriptions cannot break out of the literal.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', '..', 'ai-service', 'openapi.yaml');
const outFile = resolve(here, '..', 'src', 'generated', 'seed-spec.ts');

if (!existsSync(source)) {
  // Vercel can be configured to deploy web/ without the rest of the repo, so
  // the contract is not always reachable at build time. The generated file is
  // committed for exactly this case: fall back to it rather than failing a
  // deploy over a checkbox.
  if (existsSync(outFile)) {
    console.log(
      `embed-spec: ${source} is not in this build; keeping the committed ` +
        'src/generated/seed-spec.ts.',
    );
    process.exit(0);
  }
  console.error(`embed-spec: contract not found at ${source}`);
  console.error('and no committed src/generated/seed-spec.ts to fall back on.');
  console.error('Run this from web/ inside the api-contracts repo.');
  process.exit(1);
}

const yaml = readFileSync(source, 'utf8');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  '// GENERATED FILE — do not edit, do not commit.\n' +
    '// Written by web/scripts/embed-spec.mjs from ai-service/openapi.yaml.\n' +
    '// Regenerate with `npm run build` (or `npm run dev`) inside web/.\n\n' +
    `export const SEED_SPEC_YAML = ${JSON.stringify(yaml)};\n\n` +
    `export const SEED_SPEC_BYTES = ${Buffer.byteLength(yaml)};\n`,
);

console.log(
  `embed-spec: ai-service/openapi.yaml -> src/generated/seed-spec.ts ` +
    `(${Math.round(Buffer.byteLength(yaml) / 1024)} KiB)`,
);
