#!/usr/bin/env node
/**
 * Makes the Redocly-generated HTML self-contained.
 *
 * `redocly build-docs` emits a page that loads redoc.standalone.js from a CDN and
 * Montserrat/Roboto from Google Fonts. That means the doc only renders with internet
 * access — bad for a reference you hand around, attach to a ticket, or open on a
 * locked-down network.
 *
 * Redocly's prerenderer emits the CDN <script> tag MANY times (once per prerendered
 * chunk). We inline the ~1.1 MB bundle exactly once and delete the duplicates —
 * inlining all of them would produce a ~11 MB file.
 *
 *   node build/inline-docs.mjs docs/ai-service.html
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const target = process.argv[2];
if (!target) {
  console.error('usage: node build/inline-docs.mjs <html-file>');
  process.exit(1);
}
if (!existsSync(target)) {
  console.error(`not found: ${target}`);
  process.exit(1);
}

let bundlePath;
try {
  bundlePath = require.resolve('redoc/bundles/redoc.standalone.js');
} catch {
  console.error(
    'redoc is not installed. Run:  npm install --no-save redoc@2.5.3\n' +
      '(kept out of dependencies because it is only needed to vendor the bundle)',
  );
  process.exit(1);
}

const before = statSync(target).size;
let html = readFileSync(target, 'utf8');
const bundle = readFileSync(bundlePath, 'utf8');

// The "powered by Redoc" credit link. Note this is a PREFIX of the CDN host
// (cdn.redocly.com/redoc/...), so match it exactly rather than by substring —
// getting this wrong silently hides leftover CDN references.
const CREDIT_LINK = 'https://redocly.com/redoc/';

// 1. Inline the bundle at the first CDN script tag, drop every other copy.
const cdnScript = /<script\s+src="https:\/\/cdn\.redocly\.com\/[^"]+"[^>]*>\s*<\/script>/g;
const occurrences = html.match(cdnScript)?.length ?? 0;
if (occurrences === 0) {
  console.error('No CDN script tag found — Redocly output format may have changed.');
  process.exit(1);
}

let inlined = false;
html = html.replace(cdnScript, () => {
  if (inlined) return ''; // duplicate — drop it
  inlined = true;
  // </script> inside the bundle would close our tag early.
  return `<script>${bundle.replace(/<\/script>/gi, '<\\/script>')}</script>`;
});

// 2. Drop the Google Fonts stylesheet (Redoc falls back to system fonts).
html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*/g, '');

writeFileSync(target, html);

// 3. Verify nothing external is left.
const leftover = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => u !== CREDIT_LINK);

const kb = (n) => `${Math.round(n / 1024)} KiB`;
console.log(
  `inlined redoc bundle once, dropped ${occurrences - 1} duplicate script tag(s): ` +
    `${kb(before)} -> ${kb(statSync(target).size)}`,
);

if (leftover.length) {
  const counts = leftover.reduce((m, u) => m.set(u, (m.get(u) ?? 0) + 1), new Map());
  console.error('ERROR: external resources remain — the doc will not render offline:');
  for (const [url, n] of counts) console.error(`  ${n}x ${url}`);
  process.exit(1);
}
console.log('self-contained: no external resources remain');
