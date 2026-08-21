'use client';

import { useState } from 'react';
import { deref, typeLabel, type Json } from '@/lib/openapi';
import { opAnchor, partAnchor } from '@/lib/anchors';
import { InlineMarkdown, Markdown } from './Markdown';
import { Pin } from './Pin';
import { SchemaTree } from './SchemaTree';

/** One endpoint, collapsed to a single row until opened. */
export function OperationCard({
  doc,
  method,
  path,
  operation,
  id,
  defaultOpen = false,
}: {
  doc: Json;
  method: string;
  path: string;
  operation: Json;
  id: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const anchor = opAnchor(method, path);
  const label = `${method.toUpperCase()} ${path}`;

  return (
    <section
      className={`card op${operation.deprecated ? ' op-deprecated' : ''}`}
      id={id}
      data-open={open}
    >
      <div className="op-head">
        <button
          className="op-toggle"
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={`${id}-body`}
        >
          <span className={`method method-${method}`}>{method}</span>
          <span className="op-path">{path}</span>
          <span className="op-summary">{operation.summary ?? ''}</span>
          {operation.deprecated ? <span className="pill pill-warn">deprecated</span> : null}
          <span className="faint" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </button>
        <Pin anchor={anchor} label={label} />
      </div>

      {open ? (
        <div className="op-body" id={`${id}-body`}>
          <Markdown>{operation.description}</Markdown>

          <OperationExtensions operation={operation} />
          <Parameters doc={doc} operation={operation} anchor={anchor} />
          <RequestBody doc={doc} operation={operation} anchor={anchor} />
          <Responses doc={doc} operation={operation} anchor={anchor} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The `x-` extensions this repo relies on for traceability. Standard OpenAPI
 * has nowhere to put "which design screen is this for", and a renderer that
 * drops them would hide the most useful context an implementer has.
 */
function OperationExtensions({ operation }: { operation: Json }) {
  const designRefs: Json[] = operation['x-design-refs'] ?? [];
  const timeout = operation['x-timeout-ms'];
  const operationId = operation.operationId;

  if (!designRefs.length && !timeout && !operationId) return null;

  return (
    <div className="inline" style={{ marginTop: 10, gap: 6 }}>
      {operationId ? <span className="pill mono">{operationId}</span> : null}
      {timeout ? <span className="pill">client timeout {timeout} ms</span> : null}
      {designRefs.map((ref: Json, index: number) => (
        <span
          key={index}
          className="pill"
          title={[ref.title, ref.usedFor].filter(Boolean).join(' — ')}
        >
          design {ref.screen}
        </span>
      ))}
    </div>
  );
}

function Parameters({ doc, operation, anchor }: { doc: Json; operation: Json; anchor: string }) {
  const parameters: Json[] = (operation.parameters ?? []).map((p: Json) => deref(doc, p));
  if (!parameters.length) return null;

  const groups = ['path', 'query', 'header', 'cookie'] as const;

  return (
    <>
      {groups.map((location) => {
        const inGroup = parameters.filter((p) => p.in === location);
        if (!inGroup.length) return null;

        return (
          <div key={location}>
            <div className="sub">
              {location} parameters
              <Pin
                anchor={partAnchor(anchor, `parameters.${location}`)}
                label={`${anchor} › ${location} parameters`}
              />
            </div>
            {inGroup.map((parameter) => (
              <div className="row" key={parameter.name}>
                <div className="row-main">
                  <div className="inline" style={{ gap: 6 }}>
                    <span className="row-name">{parameter.name}</span>
                    <span className="row-type">{typeLabel(doc, parameter.schema ?? {})}</span>
                    {parameter.required ? <span className="pill pill-required">required</span> : null}
                    <Pin
                      anchor={partAnchor(anchor, `parameters.${parameter.name}`)}
                      label={`${anchor} › ${parameter.name}`}
                    />
                  </div>
                  {parameter.description ? (
                    <div className="row-desc">
                      <InlineMarkdown>{parameter.description}</InlineMarkdown>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function RequestBody({ doc, operation, anchor }: { doc: Json; operation: Json; anchor: string }) {
  const body = deref(doc, operation.requestBody);
  if (!body) return null;

  const [mediaType, media] = Object.entries<Json>(body.content ?? {})[0] ?? [];
  if (!media) return null;

  return (
    <div>
      <div className="sub">
        request body
        {body.required ? <span className="pill pill-required">required</span> : null}
        <span className="faint mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
          {mediaType}
        </span>
        <Pin anchor={partAnchor(anchor, 'requestBody')} label={`${anchor} › request body`} />
      </div>
      <Markdown className="small">{body.description}</Markdown>
      <SchemaTree
        doc={doc}
        schema={media.schema}
        anchorBase={anchor}
        anchorPath="requestBody"
      />
      <Example media={media} />
    </div>
  );
}

function Responses({ doc, operation, anchor }: { doc: Json; operation: Json; anchor: string }) {
  const responses = Object.entries<Json>(operation.responses ?? {});
  if (!responses.length) return null;

  return (
    <div>
      <div className="sub">
        responses
        <Pin anchor={partAnchor(anchor, 'responses')} label={`${anchor} › responses`} />
      </div>
      {responses.map(([code, raw]) => (
        <ResponseRow key={code} doc={doc} code={code} raw={raw} anchor={anchor} />
      ))}
    </div>
  );
}

function ResponseRow({ doc, code, raw, anchor }: { doc: Json; code: string; raw: Json; anchor: string }) {
  // The contract expands 200 and 202 by default in redocly.yaml; matching that
  // here keeps the hosted reference and the offline HTML build consistent.
  const [open, setOpen] = useState(code === '200' || code === '202');
  const response = deref(doc, raw);
  const [mediaType, media] = Object.entries<Json>(response?.content ?? {})[0] ?? [];

  const family = code.startsWith('2')
    ? 'status-2xx'
    : code.startsWith('3')
      ? 'status-3xx'
      : code.startsWith('4')
        ? 'status-4xx'
        : code.startsWith('5')
          ? 'status-5xx'
          : '';

  return (
    <div className="row">
      <div className="row-main">
        <div className="status-row">
          <span className={`status-code ${family}`}>{code}</span>
          <span className="row-desc" style={{ flex: 1, marginTop: 0 }}>
            <InlineMarkdown>{response?.description}</InlineMarkdown>
          </span>
          <Pin
            anchor={partAnchor(anchor, `responses.${code}`)}
            label={`${anchor} › ${code}`}
          />
          {media ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(!open)}>
              {open ? '▾' : '▸'} schema
            </button>
          ) : null}
        </div>

        {open && media ? (
          <div className="nested" style={{ marginTop: 8 }}>
            <div className="faint small mono">{mediaType}</div>
            <SchemaTree
              doc={doc}
              schema={media.schema}
              anchorBase={anchor}
              anchorPath={`responses.${code}`}
            />
            <Example media={media} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The first example, if the contract carries one. */
function Example({ media }: { media: Json }) {
  const example =
    media.example ?? Object.values<Json>(media.examples ?? {})[0]?.value ?? undefined;
  if (example === undefined) return null;

  return (
    <details>
      <summary className="faint small" style={{ cursor: 'pointer', margin: '6px 0' }}>
        Example
      </summary>
      <pre className="code">{JSON.stringify(example, null, 2)}</pre>
    </details>
  );
}
