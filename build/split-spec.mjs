#!/usr/bin/env node
/**
 * Explodes a single-file OpenAPI document into the one-thing-per-file layout
 * for one spec.
 *
 *   node build/split-spec.mjs dist/course-outline.openapi.yaml course-outline
 *
 * Layout produced (for output dir <dir>):
 *
 *   <dir>/openapi.yaml                      root: info, servers, tags, $refs
 *   <dir>/paths/<slug>.yaml                 one path item each
 *   <dir>/components/parameters/<Name>.yaml
 *   <dir>/components/headers/<Name>.yaml
 *   <dir>/components/responses/<Name>.yaml
 *   <dir>/components/securitySchemes/<Name>.yaml
 *   <dir>/components/schemas/<Name>.yaml
 *
 * Each spec is one domain by construction, so schemas are not filed into a
 * common/outline/content subfolder the way they were before the contract was
 * split into separate specs — there is no second domain left inside a single
 * spec's bundle to disambiguate against.
 *
 * Components listed in build/shared-components.json live in shared/ instead
 * and are treated as read-only input here: this script never writes into
 * shared/, so splitting spec A right after spec B can't clobber shared files
 * spec B just wrote. shared/ is written once, by the migration that first
 * created it, and hand-maintained after that.
 *
 * The operation is idempotent: splitting, bundling and splitting again gives
 * byte-identical files, which is what makes `npm run pull` safe to re-run.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const input = process.argv[2];
const outSlug = process.argv[3];

if (!input || !outSlug) {
  console.error('usage: node build/split-spec.mjs <bundled-yaml> <output-dir>');
  console.error('  e.g. node build/split-spec.mjs dist/course-outline.openapi.yaml course-outline');
  process.exit(1);
}

const inputPath = resolve(repo, input);
if (!existsSync(inputPath)) {
  console.error(`split-spec: ${relative(repo, inputPath)} not found. Run \`npm run bundle\` first.`);
  process.exit(1);
}

const doc = parse(readFileSync(inputPath, 'utf8'));
if (!doc?.paths || !doc?.components) {
  console.error('split-spec: that does not look like a bundled OpenAPI document.');
  process.exit(1);
}

const SHARED = JSON.parse(readFileSync(resolve(repo, 'build/shared-components.json'), 'utf8'));
const serviceDir = resolve(repo, outSlug);

/* ----------------------------- ref plumbing ---------------------------- */

const COMPONENT_GROUPS = ['schemas', 'responses', 'parameters', 'headers', 'securitySchemes'];

function refTarget(ref) {
  const [, , group, name] = ref.split('/');
  return { group, name };
}

/** A filename-safe slug for a path template, e.g. /a/{id}/x -> a-id-x. */
function pathSlug(apiPath) {
  return (
    apiPath
      .replace(/^\/+/, '')
      .replace(/\{([^}]+)\}/g, '$1')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'root'
  );
}

function isShared(group, name) {
  return SHARED[group]?.includes(name) ?? false;
}

/** Repo-relative location of a component, as a POSIX path. */
function locationOf(group, name) {
  if (isShared(group, name)) return `shared/components/${group}/${name}.yaml`;
  return `${outSlug}/components/${group}/${name}.yaml`;
}

const pathEntries = Object.entries(doc.paths);
const pathLocations = new Map(pathEntries.map(([apiPath]) => [apiPath, `${outSlug}/paths/${pathSlug(apiPath)}.yaml`]));

/** `./x.yaml` or `../y/z.yaml`, relative to the file doing the referring. */
function relativeRef(fromFile, toFile) {
  const rel = relative(posix.dirname(fromFile).split('/').join(sep), toFile.split('/').join(sep))
    .split(sep)
    .join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Rewrites internal `#/components/...` pointers into file references, relative
 * to whichever file the node is about to be written into. Returns a new tree;
 * the input is left alone so later passes still see the original pointers.
 */
function rewriteRefs(node, fromFile) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, fromFile));

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/')) {
      const { group, name } = refTarget(value);
      if (!COMPONENT_GROUPS.includes(group) || !doc.components?.[group]?.[name]) {
        console.warn(`split-spec: leaving unresolvable ref untouched: ${value}`);
        out[key] = value;
        continue;
      }
      out[key] = relativeRef(fromFile, locationOf(group, name));
    } else {
      out[key] = rewriteRefs(value, fromFile);
    }
  }
  return out;
}

/* ------------------------------- writing ------------------------------- */

const HEADER =
  '# Generated by build/split-spec.mjs from the bundled contract.\n' +
  '# Edit this file directly - it is source. Run `npm run build` to re-bundle.\n';

const YAML_OPTIONS = {
  lineWidth: 0, // never fold long description lines
  aliasDuplicateObjects: false, // no surprise &anchors in the output
  minContentWidth: 0,
};

let written = 0;
function writeYaml(repoRelative, value) {
  const absolute = resolve(repo, repoRelative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, HEADER + stringify(value, YAML_OPTIONS));
  written += 1;
}

// Start clean so a renamed operation does not leave an orphan file behind
// that still lints and still gets bundled. Never touches shared/ — that is
// not this spec's to regenerate.
for (const dir of ['paths', 'components']) {
  rmSync(resolve(serviceDir, dir), { recursive: true, force: true });
}

// 1. Path items.
for (const [apiPath, item] of pathEntries) {
  const file = pathLocations.get(apiPath);
  writeYaml(file, rewriteRefs(item, file));
}

// 2. Components, one file per entry — skipping anything shared, since that
//    lives in shared/ and is read-only from this script's point of view.
let sharedSkipped = 0;
for (const group of COMPONENT_GROUPS) {
  for (const [name, node] of Object.entries(doc.components[group] ?? {})) {
    if (isShared(group, name)) {
      sharedSkipped += 1;
      continue;
    }
    const file = locationOf(group, name);
    writeYaml(file, rewriteRefs(node, file));
  }
}

// 3. The root document: everything that is not a path item or a component,
//    plus a $ref index of the ones that are (including shared ones, pointing
//    out to shared/).
const rootFile = `${outSlug}/openapi.yaml`;
const root = {};
for (const [key, value] of Object.entries(doc)) {
  if (key === 'paths' || key === 'components') continue;
  root[key] = value;
}

root.paths = Object.fromEntries(
  pathEntries.map(([apiPath]) => [apiPath, { $ref: relativeRef(rootFile, pathLocations.get(apiPath)) }]),
);

root.components = {};
for (const group of COMPONENT_GROUPS) {
  const entries = Object.entries(doc.components[group] ?? {});
  if (!entries.length) continue;
  root.components[group] = Object.fromEntries(
    entries.map(([name]) => [name, { $ref: relativeRef(rootFile, locationOf(group, name)) }]),
  );
}

// Preserve the original key order of the document, with paths and components
// back where they were, so the root file still reads top to bottom.
const ordered = {};
for (const key of Object.keys(doc)) ordered[key] = key === 'paths' ? root.paths : key === 'components' ? root.components : root[key];
writeYaml(rootFile, ordered);

/* ------------------------------- summary ------------------------------- */

console.log(`split-spec: ${relative(repo, inputPath)} -> ${outSlug}/ (${written} files, ${sharedSkipped} shared skipped)`);
console.log(`  ${pathEntries.length} path item(s)`);
for (const group of COMPONENT_GROUPS) {
  const n = Object.keys(doc.components[group] ?? {}).length;
  const shared = Object.keys(doc.components[group] ?? {}).filter((name) => isShared(group, name)).length;
  if (n) console.log(`  ${n} ${group} (${shared} shared, ${n - shared} own)`);
}
