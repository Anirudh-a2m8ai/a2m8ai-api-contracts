import { parse as parseYaml } from 'yaml';

/**
 * Just enough OpenAPI to render and to validate. Not a full implementation —
 * it handles the subset this contract uses, and degrades to showing the raw
 * shape rather than throwing on anything it does not recognise.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any;

export interface OperationEntry {
  method: string;
  path: string;
  operation: Json;
}

export interface TagGroup {
  name: string;
  description: string;
  operations: OperationEntry[];
}

export interface ParsedSpec {
  doc: Json;
  info: Json;
  tags: TagGroup[];
  schemas: [name: string, schema: Json][];
}

export const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

export interface ValidationResult {
  ok: boolean;
  /** Hard errors — the contract cannot be saved while any of these stand. */
  errors: string[];
  /** Worth fixing, but not blocking. */
  warnings: string[];
  doc: Json | null;
}

/**
 * Structural validation, run before any write.
 *
 * This is not a substitute for `npm run lint` at the repo root, where Redocly
 * enforces the house rules in redocly.yaml. It is the narrower gate that stops
 * a broken document from being stored and taking the docs page down for
 * everyone — so it blocks on things that break rendering, and only warns about
 * house-style omissions that would otherwise trap the owner mid-edit.
 */
export function validateSpec(yamlText: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!yamlText.trim()) {
    return { ok: false, errors: ['The contract is empty.'], warnings, doc: null };
  }

  let doc: Json;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`YAML syntax error: ${message}`], warnings, doc: null };
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return {
      ok: false,
      errors: ['The contract must be a YAML mapping at the top level.'],
      warnings,
      doc: null,
    };
  }

  if (!doc.openapi) {
    errors.push('Missing `openapi:` version at the top level.');
  } else if (!/^3\./.test(String(doc.openapi))) {
    errors.push(`Unsupported OpenAPI version "${doc.openapi}" — this tool renders 3.x.`);
  }

  if (!doc.info) {
    errors.push('Missing `info:` block.');
  } else {
    if (!doc.info.title) errors.push('`info.title` is required.');
    if (!doc.info.version) errors.push('`info.version` is required.');
  }

  if (!doc.paths || typeof doc.paths !== 'object') {
    errors.push('Missing `paths:` block.');
  } else {
    for (const [path, item] of Object.entries<Json>(doc.paths)) {
      if (!path.startsWith('/')) errors.push(`Path "${path}" must start with a slash.`);
      if (!item || typeof item !== 'object') continue;
      for (const method of METHODS) {
        const operation = item[method];
        if (!operation) continue;
        const label = `${method.toUpperCase()} ${path}`;
        // operationId and summary mirror the operation-* rules in redocly.yaml.
        if (!operation.operationId) warnings.push(`${label} has no operationId.`);
        if (!operation.summary) warnings.push(`${label} has no summary.`);
        if (!operation.responses) errors.push(`${label} has no responses.`);
      }
    }
  }

  // A $ref into components that does not resolve renders as a blank panel,
  // which is worse for a reader than a loud failure.
  for (const ref of collectRefs(doc)) {
    if (ref.startsWith('#/') && resolvePointer(doc, ref) === undefined) {
      errors.push(`Unresolved reference: ${ref}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings: warnings.slice(0, 40), doc };
}

function collectRefs(node: Json, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
    return out;
  }
  for (const [key, value] of Object.entries<Json>(node)) {
    if (key === '$ref' && typeof value === 'string') out.add(value);
    else collectRefs(value, out);
  }
  return out;
}

function resolvePointer(doc: Json, ref: string): Json {
  const parts = ref.slice(2).split('/').map(decodePointerSegment);
  let node: Json = doc;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function decodePointerSegment(segment: string): string {
  return decodeURIComponent(segment).split('~1').join('/').split('~0').join('~');
}

/** Organises a parsed document into what the viewer renders, tag by tag. */
export function parseSpec(yamlText: string): ParsedSpec | null {
  let doc: Json;
  try {
    doc = parseYaml(yamlText);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;

  const operations: OperationEntry[] = [];
  for (const [path, item] of Object.entries<Json>(doc.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const method of METHODS) {
      if (item[method]) operations.push({ method, path, operation: item[method] });
    }
  }

  // Declared tags keep the author's ordering; a tag referenced by an operation
  // but never declared is appended, so an operation can never silently vanish.
  const declared: TagGroup[] = (doc.tags ?? []).map((tag: Json) => ({
    name: tag.name,
    description: tag.description ?? '',
    operations: [],
  }));
  const groups = new Map<string, TagGroup>(declared.map((group) => [group.name, group]));

  const untagged: TagGroup = { name: 'Other', description: '', operations: [] };

  for (const entry of operations) {
    const names: string[] = entry.operation.tags?.length ? entry.operation.tags : [];
    if (!names.length) {
      untagged.operations.push(entry);
      continue;
    }
    for (const name of names) {
      let group = groups.get(name);
      if (!group) {
        group = { name, description: '', operations: [] };
        groups.set(name, group);
        declared.push(group);
      }
      group.operations.push(entry);
    }
  }

  const tags = declared.filter((group) => group.operations.length > 0);
  if (untagged.operations.length) tags.push(untagged);

  const schemas = Object.entries<Json>(doc.components?.schemas ?? {});

  return { doc, info: doc.info ?? {}, tags, schemas };
}

/**
 * Follows `$ref` one hop at a time, with a depth cap.
 *
 * The contract is recursive in places — a schema reaching itself through
 * `items` — so an eager full deref would not terminate. The viewer resolves
 * lazily instead, as the reader expands each node.
 */
export function deref(doc: Json, node: Json, depth = 0): Json {
  if (!node || typeof node !== 'object' || depth > 20) return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    const target = resolvePointer(doc, node.$ref);
    if (target === undefined) return node;
    return deref(doc, target, depth + 1);
  }
  return node;
}

/** The trailing segment of a `$ref`, which is the component's name. */
export function refName(ref: string): string {
  return decodePointerSegment(ref.split('/').pop() ?? ref);
}

/** A one-line type description for a schema node, e.g. `string (uuid)`. */
export function typeLabel(doc: Json, node: Json): string {
  if (!node || typeof node !== 'object') return 'any';
  if (typeof node.$ref === 'string') return refName(node.$ref);

  const resolved = node;
  if (resolved.allOf) return 'object';
  if (resolved.oneOf) return resolved.oneOf.map((n: Json) => typeLabel(doc, n)).join(' | ');
  if (resolved.anyOf) return resolved.anyOf.map((n: Json) => typeLabel(doc, n)).join(' | ');

  const base = Array.isArray(resolved.type) ? resolved.type.join(' | ') : (resolved.type ?? 'any');
  if (base === 'array') {
    const items = resolved.items ? typeLabel(doc, resolved.items) : 'any';
    return `${items}[]`;
  }
  if (resolved.enum) return `${base} (enum)`;
  return resolved.format ? `${base} (${resolved.format})` : String(base);
}
