'use client';

import { useState } from 'react';
import { deref, refName, typeLabel, type Json } from '@/lib/openapi';
import { partAnchor } from '@/lib/anchors';
import { InlineMarkdown, Markdown } from './Markdown';
import { Pin } from './Pin';

/**
 * Renders a schema as an expandable property list.
 *
 * Nested objects stay collapsed until asked for. The contract composes
 * envelopes with `allOf`, so eagerly expanding everything would bury the two
 * fields an operation actually adds under the same wrapper repeated on every
 * endpoint.
 */

const MAX_DEPTH = 6;

export function SchemaTree({
  doc,
  schema,
  anchorBase,
  anchorPath = '',
  depth = 0,
}: {
  doc: Json;
  schema: Json;
  /** The anchor of the thing that owns this schema, e.g. an operation. */
  anchorBase: string;
  /** Dotted path within that thing, used to build per-property anchors. */
  anchorPath?: string;
  depth?: number;
}) {
  const resolved = deref(doc, schema);
  if (!resolved || typeof resolved !== 'object') return null;

  if (depth > MAX_DEPTH) {
    return <p className="faint small">Nested further — open the YAML to read the rest.</p>;
  }

  // allOf is how every response in this contract layers its own `data` onto
  // the shared envelope. Flatten it so the reader sees one property list.
  if (Array.isArray(resolved.allOf)) {
    return (
      <>
        {resolved.allOf.map((part: Json, index: number) => (
          <SchemaTree
            key={index}
            doc={doc}
            schema={part}
            anchorBase={anchorBase}
            anchorPath={anchorPath}
            depth={depth}
          />
        ))}
      </>
    );
  }

  const variants: Json[] | undefined = resolved.oneOf ?? resolved.anyOf;
  if (Array.isArray(variants)) {
    return (
      <div className="stack">
        <p className="faint small" style={{ margin: 0 }}>
          {resolved.oneOf ? 'One of:' : 'Any of:'}
        </p>
        {variants.map((variant: Json, index: number) => (
          <div key={index} className="nested">
            <div className="row-type" style={{ marginLeft: 0 }}>
              {typeLabel(doc, variant)}
            </div>
            <SchemaTree
              doc={doc}
              schema={variant}
              anchorBase={anchorBase}
              anchorPath={anchorPath}
              depth={depth + 1}
            />
          </div>
        ))}
      </div>
    );
  }

  if (resolved.type === 'array' && resolved.items) {
    return (
      <div className="nested">
        <div className="row-type" style={{ marginLeft: 0 }}>
          array of {typeLabel(doc, resolved.items)}
        </div>
        <SchemaTree
          doc={doc}
          schema={resolved.items}
          anchorBase={anchorBase}
          anchorPath={anchorPath ? `${anchorPath}[]` : '[]'}
          depth={depth + 1}
        />
      </div>
    );
  }

  const properties: Record<string, Json> | undefined = resolved.properties;
  if (!properties || !Object.keys(properties).length) {
    return resolved.description ? <Markdown className="small">{resolved.description}</Markdown> : null;
  }

  const required: string[] = resolved.required ?? [];

  return (
    <div>
      {Object.entries(properties).map(([name, property]) => (
        <PropertyRow
          key={name}
          doc={doc}
          name={name}
          property={property}
          required={required.includes(name)}
          anchorBase={anchorBase}
          anchorPath={anchorPath ? `${anchorPath}.${name}` : name}
          depth={depth}
        />
      ))}
    </div>
  );
}

function PropertyRow({
  doc,
  name,
  property,
  required,
  anchorBase,
  anchorPath,
  depth,
}: {
  doc: Json;
  name: string;
  property: Json;
  required: boolean;
  anchorBase: string;
  anchorPath: string;
  depth: number;
}) {
  const [open, setOpen] = useState(false);
  const resolved = deref(doc, property);

  // Whether there is anything worth expanding into.
  const expandable =
    resolved &&
    typeof resolved === 'object' &&
    (resolved.properties ||
      resolved.allOf ||
      resolved.oneOf ||
      resolved.anyOf ||
      (resolved.type === 'array' && deref(doc, resolved.items)?.properties));

  const anchor = partAnchor(anchorBase, anchorPath);
  const isRef = typeof property?.$ref === 'string';

  return (
    <div className="row">
      <div className="row-main">
        <div className="inline" style={{ gap: 6 }}>
          <span className="row-name">{name}</span>
          <span className="row-type">{typeLabel(doc, property)}</span>
          {required ? <span className="pill pill-required">required</span> : null}
          {resolved?.deprecated ? <span className="pill pill-warn">deprecated</span> : null}
          {isRef ? <span className="pill">{refName(property.$ref)}</span> : null}
          <Pin anchor={anchor} label={`${anchorBase} › ${anchorPath}`} />
        </div>

        {resolved?.description ? (
          <div className="row-desc">
            <InlineMarkdown>{resolved.description}</InlineMarkdown>
          </div>
        ) : null}

        <ConstraintList schema={resolved} />

        {expandable ? (
          <>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(!open)}>
              {open ? '▾ hide' : '▸ show'} {name}
            </button>
            {open ? (
              <div className="nested">
                <SchemaTree
                  doc={doc}
                  schema={property}
                  anchorBase={anchorBase}
                  anchorPath={anchorPath}
                  depth={depth + 1}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Enum values, bounds, patterns, defaults, and the contract's `x-constraint`. */
function ConstraintList({ schema }: { schema: Json }) {
  if (!schema || typeof schema !== 'object') return null;

  const bits: string[] = [];
  if (schema.enum) bits.push(`one of: ${schema.enum.join(', ')}`);
  if (schema.default !== undefined) bits.push(`default: ${JSON.stringify(schema.default)}`);
  if (schema.minimum !== undefined) bits.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) bits.push(`max ${schema.maximum}`);
  if (schema.minLength !== undefined) bits.push(`min length ${schema.minLength}`);
  if (schema.maxLength !== undefined) bits.push(`max length ${schema.maxLength}`);
  if (schema.minItems !== undefined) bits.push(`min items ${schema.minItems}`);
  if (schema.maxItems !== undefined) bits.push(`max items ${schema.maxItems}`);
  if (schema.pattern) bits.push(`pattern ${schema.pattern}`);
  if (schema.example !== undefined) bits.push(`example: ${JSON.stringify(schema.example)}`);
  // A house extension: rules JSON Schema cannot express, per the repo README.
  if (schema['x-constraint']) bits.push(String(schema['x-constraint']));

  if (!bits.length) return null;

  return (
    <div className="faint small mono" style={{ marginTop: 2 }}>
      {bits.join(' · ')}
    </div>
  );
}
