import { deref, type Json } from './openapi';

/**
 * Payload samples for the right-hand panel.
 *
 * Two jobs. Pull out the examples the contract already carries — this one is
 * rich in them, and named (`typical`, `minimal`, `regenerate`) — and, where an
 * operation has none, synthesise one from the schema so the panel is never
 * empty beside prose that describes a payload.
 *
 * A synthesised sample is a shape, not a fixture: it exists so a reader can
 * see the nesting at a glance, and it is labelled as generated in the UI so
 * nobody pastes it into a test expecting the service to accept it.
 */

export interface NamedExample {
  /** The key under `examples:`, or a stand-in for the singular forms. */
  name: string;
  summary?: string;
  description?: string;
  value: Json;
  /** True when this came out of schemaSample rather than the contract. */
  generated?: boolean;
}

/** Every example a media-type object offers, in the order it declares them. */
export function mediaExamples(doc: Json, media: Json): NamedExample[] {
  if (!media || typeof media !== 'object') return [];

  const named = media.examples;
  if (named && typeof named === 'object') {
    const out: NamedExample[] = [];
    for (const [name, raw] of Object.entries<Json>(named)) {
      const entry = deref(doc, raw);
      if (!entry || entry.value === undefined) continue;
      out.push({
        name,
        summary: entry.summary,
        description: entry.description,
        value: entry.value,
      });
    }
    if (out.length) return out;
  }

  if (media.example !== undefined) {
    return [{ name: 'example', value: media.example }];
  }

  if (media.schema) {
    const value = schemaSample(doc, media.schema);
    if (value !== undefined) return [{ name: 'shape', value, generated: true }];
  }

  return [];
}

const MAX_DEPTH = 9;

/**
 * A representative value for a schema.
 *
 * Prefers whatever the contract states — `example`, then `default`, then the
 * first `enum` member — and only invents a placeholder once none of those are
 * there. `seen` carries the `$ref`s already on this branch: the contract is
 * recursive (a TopicNode reaches itself through `subTopics`), so without it
 * this would not terminate.
 */
export function schemaSample(doc: Json, schema: Json, depth = 0, seen: string[] = []): Json {
  if (!schema || typeof schema !== 'object' || depth > MAX_DEPTH) return undefined;

  let branch = seen;
  const ref = typeof schema.$ref === 'string' ? schema.$ref : null;
  if (ref) {
    // Second visit to the same component on one branch: stop, rather than
    // recursing to the depth cap and burying the levels worth reading.
    if (branch.includes(ref)) return undefined;
    branch = [...branch, ref];
  }

  const node = deref(doc, schema);
  if (!node || typeof node !== 'object') return undefined;

  if (node.example !== undefined) return node.example;
  if (node.default !== undefined) return node.default;
  if (Array.isArray(node.enum) && node.enum.length) return node.enum[0];

  if (Array.isArray(node.allOf)) {
    // Every response layers its own `data` onto SuccessEnvelope with allOf, so
    // the branches have to be merged rather than chosen between.
    const merged: Record<string, Json> = {};
    let scalar: Json = undefined;
    for (const part of node.allOf) {
      const value = schemaSample(doc, part, depth, branch);
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(merged, value);
      else if (value !== undefined) scalar = value;
    }
    if (node.properties) Object.assign(merged, objectSample(doc, node, depth, branch));
    return Object.keys(merged).length ? merged : scalar;
  }

  const variants: Json[] | undefined = node.oneOf ?? node.anyOf;
  if (Array.isArray(variants) && variants.length) {
    return schemaSample(doc, variants[0], depth, branch);
  }

  const type = Array.isArray(node.type) ? node.type[0] : node.type;

  if (type === 'array' || node.items) {
    const item = schemaSample(doc, node.items, depth + 1, branch);
    return item === undefined ? [] : [item];
  }

  if (type === 'object' || node.properties) {
    return objectSample(doc, node, depth, branch);
  }

  return scalarSample(node, type);
}

function objectSample(doc: Json, node: Json, depth: number, seen: string[]): Json {
  const properties: Record<string, Json> | undefined = node.properties;
  if (!properties) return {};

  const required: string[] = Array.isArray(node.required) ? node.required : [];
  const out: Record<string, Json> = {};

  for (const [name, property] of Object.entries(properties)) {
    const value = schemaSample(doc, property, depth + 1, seen);
    if (value === undefined) {
      // A branch that bottomed out on recursion still belongs in the sample:
      // dropping it would show the shape as not having that field at all.
      if (required.includes(name)) out[name] = null;
      continue;
    }
    out[name] = value;
  }

  return out;
}

/** Placeholders keyed off `format`, so a uuid field does not read "string". */
function scalarSample(node: Json, type: string | undefined): Json {
  switch (type) {
    case 'integer':
    case 'number':
      return node.minimum !== undefined ? node.minimum : 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'string':
      break;
    default:
      // No `type` and no `format` is a schema with nothing to go on.
      if (node.format === undefined) return undefined;
  }

  switch (node.format) {
    case 'uuid':
      return '3f7c2a10-9b41-4c8e-a2d5-6e1f0b3c7d84';
    case 'date-time':
      return '2026-08-18T10:30:00.000Z';
    case 'date':
      return '2026-08-18';
    case 'uri':
    case 'url':
      return 'https://example.com';
    case 'email':
      return 'name@example.com';
    default:
      return 'string';
  }
}

/* --------------------------- JSON, tokenised --------------------------- */

export type TokenKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
}

/**
 * Serialises a value to pretty JSON as classified tokens.
 *
 * Colouring a `<pre>` this way rather than by regex over rendered text means
 * the classification comes from the value itself — a string whose contents
 * happen to look like a number cannot be mis-coloured, and no markup is
 * produced that would then need escaping.
 */
export function tokenizeJson(value: Json, indent = 0, out: Token[] = []): Token[] {
  const pad = (level: number) => '  '.repeat(level);

  if (value === null || value === undefined) {
    out.push({ kind: 'null', text: 'null' });
    return out;
  }
  if (typeof value === 'string') {
    out.push({ kind: 'string', text: JSON.stringify(value) });
    return out;
  }
  if (typeof value === 'number') {
    out.push({ kind: 'number', text: String(value) });
    return out;
  }
  if (typeof value === 'boolean') {
    out.push({ kind: 'bool', text: String(value) });
    return out;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      out.push({ kind: 'punct', text: '[]' });
      return out;
    }
    out.push({ kind: 'punct', text: '[\n' });
    value.forEach((item, index) => {
      out.push({ kind: 'punct', text: pad(indent + 1) });
      tokenizeJson(item, indent + 1, out);
      out.push({ kind: 'punct', text: index === value.length - 1 ? '\n' : ',\n' });
    });
    out.push({ kind: 'punct', text: `${pad(indent)}]` });
    return out;
  }

  const entries = Object.entries(value as Record<string, Json>);
  if (!entries.length) {
    out.push({ kind: 'punct', text: '{}' });
    return out;
  }

  out.push({ kind: 'punct', text: '{\n' });
  entries.forEach(([key, item], index) => {
    out.push({ kind: 'punct', text: pad(indent + 1) });
    out.push({ kind: 'key', text: JSON.stringify(key) });
    out.push({ kind: 'punct', text: ': ' });
    tokenizeJson(item, indent + 1, out);
    out.push({ kind: 'punct', text: index === entries.length - 1 ? '\n' : ',\n' });
  });
  out.push({ kind: 'punct', text: `${pad(indent)}}` });
  return out;
}

/** Flattens tokens back to the plain text a copy button should put on the clipboard. */
export function tokensToText(tokens: Token[]): string {
  return tokens.map((token) => token.text).join('');
}
