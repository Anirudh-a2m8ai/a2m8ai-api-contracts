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
 *
 * Depth is carried in the markup rather than in inline padding: each level
 * nests inside a `.schema-branch`, which draws the guide line that tells a
 * reader which parent a field hangs off. Twelve fields at three depths with no
 * guide is the part of the old layout that read as a wall.
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
    return <p className="schema-note">Nested further — open the YAML to read the rest.</p>;
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
      <div className="schema-variants">
        <p className="schema-note">{resolved.oneOf ? 'One of:' : 'Any of:'}</p>
        {variants.map((variant: Json, index: number) => (
          <div key={index} className="schema-branch">
            <div className="schema-branch-label">{typeLabel(doc, variant)}</div>
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
      <div className="schema-branch">
        <div className="schema-branch-label">array of {typeLabel(doc, resolved.items)}</div>
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
    return resolved.description ? (
      <Markdown className="field-desc small">{resolved.description}</Markdown>
    ) : null;
  }

  const required: string[] = resolved.required ?? [];

  // Required first, matching `requiredPropsFirst` in redocly.yaml, so the
  // hosted reference and the offline HTML order fields the same way. Within
  // each half the contract's own ordering is kept.
  const entries = Object.entries(properties);
  const ordered = [
    ...entries.filter(([name]) => required.includes(name)),
    ...entries.filter(([name]) => !required.includes(name)),
  ];

  return (
    <div className="schema-fields">
      {ordered.map(([name, property]) => (
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
  const expandable = Boolean(
    resolved &&
      typeof resolved === 'object' &&
      (resolved.properties ||
        resolved.allOf ||
        resolved.oneOf ||
        resolved.anyOf ||
        (resolved.type === 'array' && deref(doc, resolved.items)?.properties)),
  );

  const anchor = partAnchor(anchorBase, anchorPath);
  const isRef = typeof property?.$ref === 'string';

  return (
    <div className="field-row" data-expandable={expandable} data-open={open}>
      <div className="field-key">
        {/*
          The caret sits on the name rather than under the description, where
          it used to be. A control that opens a field belongs beside the field
          it opens; below the prose it read as a separate list item.
        */}
        {expandable ? (
          <button
            className="field-caret"
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${name}`}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="field-caret field-caret-empty" aria-hidden />
        )}
        <span className="field-name">{name}</span>
        <span className="field-type">{typeLabel(doc, property)}</span>
        {required ? <span className="field-required">required</span> : null}
        {resolved?.deprecated ? <span className="pill pill-warn">deprecated</span> : null}
        {isRef ? <span className="field-tag">{refName(property.$ref)}</span> : null}
        <Pin anchor={anchor} label={`${anchorBase} › ${anchorPath}`} />
      </div>

      {resolved?.description ? (
        <div className="field-desc">
          <InlineMarkdown>{resolved.description}</InlineMarkdown>
        </div>
      ) : null}

      <ConstraintList schema={resolved} />

      {expandable && open ? (
        <div className="schema-branch">
          <SchemaTree
            doc={doc}
            schema={property}
            anchorBase={anchorBase}
            anchorPath={anchorPath}
            depth={depth + 1}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Enum values, bounds, patterns, defaults, and the contract's `x-constraint`. */
function ConstraintList({ schema }: { schema: Json }) {
  if (!schema || typeof schema !== 'object') return null;

  const bits: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => bits.push({ label, value: String(value) });

  if (schema.enum) {
    // Enums are the constraint readers scan for, so each member is its own
    // chip rather than one long comma-joined run.
    return (
      <div className="constraints">
        <span className="constraint-label">one of</span>
        {schema.enum.map((value: Json) => (
          <span className="constraint constraint-enum" key={String(value)}>
            {String(value)}
          </span>
        ))}
        <ScalarConstraints schema={schema} />
      </div>
    );
  }

  if (schema.default !== undefined) add('default', JSON.stringify(schema.default));
  if (schema.minimum !== undefined) add('min', schema.minimum);
  if (schema.maximum !== undefined) add('max', schema.maximum);
  if (schema.minLength !== undefined) add('min length', schema.minLength);
  if (schema.maxLength !== undefined) add('max length', schema.maxLength);
  if (schema.minItems !== undefined) add('min items', schema.minItems);
  if (schema.maxItems !== undefined) add('max items', schema.maxItems);
  if (schema.pattern) add('pattern', schema.pattern);
  if (schema.example !== undefined) add('example', JSON.stringify(schema.example));
  // A house extension: rules JSON Schema cannot express, per the repo README.
  if (schema['x-constraint']) bits.push({ label: '', value: String(schema['x-constraint']) });

  if (!bits.length) return null;

  return (
    <div className="constraints">
      {bits.map((bit, index) => (
        <span className="constraint" key={index}>
          {bit.label ? <span className="constraint-label">{bit.label}</span> : null}
          {bit.value}
        </span>
      ))}
    </div>
  );
}

/** The non-enum constraints, for a schema that also has an enum. */
function ScalarConstraints({ schema }: { schema: Json }) {
  if (schema.default === undefined) return null;
  return (
    <span className="constraint">
      <span className="constraint-label">default</span>
      {JSON.stringify(schema.default)}
    </span>
  );
}
