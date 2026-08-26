'use client';

import { useState } from 'react';
import { deref, typeLabel, type Json } from '@/lib/openapi';
import { opAnchor, partAnchor } from '@/lib/anchors';
import { InlineMarkdown, Markdown } from './Markdown';
import { Pin } from './Pin';
import { SamplePanel, statusFamily } from './SamplePanel';
import { SchemaTree } from './SchemaTree';

/**
 * One endpoint, in two columns: what it means on the left, what goes over the
 * wire on the right.
 *
 * Open by default. This contract has six operations, and a reader arriving at
 * it wants to read it — collapsing each one behind a click meant the page's
 * first screen was six grey rows that said almost nothing. The toggle stays,
 * because folding one away while comparing two others is worth having.
 */
export function OperationCard({
  doc,
  method,
  path,
  operation,
  id,
  defaultOpen = true,
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
      className={`op${operation.deprecated ? ' op-deprecated' : ''}`}
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
          <span className="op-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <span className={`method method-${method}`}>{method}</span>
          <span className="op-path">{path}</span>
          {operation.deprecated ? <span className="pill pill-warn">deprecated</span> : null}
          {!open && operation.summary ? (
            <span className="op-summary">{operation.summary}</span>
          ) : null}
        </button>
        <Pin anchor={anchor} label={label} />
      </div>

      {open ? (
        <div className="op-body" id={`${id}-body`}>
          <div className="op-docs">
            {operation.summary ? <h3 className="op-title">{operation.summary}</h3> : null}
            <OperationExtensions operation={operation} />
            <Markdown className="op-prose">{operation.description}</Markdown>

            <Security doc={doc} operation={operation} />
            <Parameters doc={doc} operation={operation} anchor={anchor} />
            <RequestBody doc={doc} operation={operation} anchor={anchor} />
            <Responses doc={doc} operation={operation} anchor={anchor} />
          </div>

          <div className="op-samples">
            <div className="op-samples-inner">
              <SamplePanel doc={doc} operation={operation} method={method} path={path} />
            </div>
          </div>
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
    <div className="op-tags">
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

/**
 * Which credential the endpoint wants. Rendered from `security`, falling back
 * to the document-level default, because "this needs x-api-key" was previously
 * only discoverable by reading the YAML.
 */
function Security({ doc, operation }: { doc: Json; operation: Json }) {
  const requirements: Json[] = operation.security ?? doc.security ?? [];
  if (!requirements.length) return null;

  const schemes = doc.components?.securitySchemes ?? {};
  const names = [...new Set(requirements.flatMap((entry: Json) => Object.keys(entry ?? {})))];
  if (!names.length) return null;

  return (
    <div className="op-section">
      <h4 className="sub">authorization</h4>
      {names.map((name) => {
        const scheme = deref(doc, schemes[name]);
        const where =
          scheme?.type === 'apiKey'
            ? `${scheme.name} (${scheme.in})`
            : [scheme?.type, scheme?.scheme].filter(Boolean).join(' ');

        return (
          <div className="field-row" key={name}>
            <div className="field-key">
              <span className="field-name">{name}</span>
              {where ? <span className="field-type">{where}</span> : null}
            </div>
            <Markdown className="field-desc small">{scheme?.description}</Markdown>
          </div>
        );
      })}
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
          <div className="op-section" key={location}>
            <h4 className="sub">
              {location} parameters
              <Pin
                anchor={partAnchor(anchor, `parameters.${location}`)}
                label={`${anchor} › ${location} parameters`}
              />
            </h4>
            {inGroup.map((parameter) => (
              <div className="field-row" key={parameter.name}>
                <div className="field-key">
                  <span className="field-name">{parameter.name}</span>
                  <span className="field-type">{typeLabel(doc, parameter.schema ?? {})}</span>
                  {parameter.required ? <span className="field-required">required</span> : null}
                  <Pin
                    anchor={partAnchor(anchor, `parameters.${parameter.name}`)}
                    label={`${anchor} › ${parameter.name}`}
                  />
                </div>
                {parameter.description ? (
                  <div className="field-desc">
                    <InlineMarkdown>{parameter.description}</InlineMarkdown>
                  </div>
                ) : null}
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
    <div className="op-section">
      <h4 className="sub">
        request body
        {body.required ? <span className="field-required">required</span> : null}
        <span className="sub-meta mono">{mediaType}</span>
        <Pin anchor={partAnchor(anchor, 'requestBody')} label={`${anchor} › request body`} />
      </h4>
      <Markdown className="field-desc small">{body.description}</Markdown>
      <SchemaTree doc={doc} schema={media.schema} anchorBase={anchor} anchorPath="requestBody" />
    </div>
  );
}

function Responses({ doc, operation, anchor }: { doc: Json; operation: Json; anchor: string }) {
  const responses = Object.entries<Json>(operation.responses ?? {});
  if (!responses.length) return null;

  return (
    <div className="op-section">
      <h4 className="sub">
        responses
        <Pin anchor={partAnchor(anchor, 'responses')} label={`${anchor} › responses`} />
      </h4>
      <div className="responses">
        {responses.map(([code, raw]) => (
          <ResponseRow key={code} doc={doc} code={code} raw={raw} anchor={anchor} />
        ))}
      </div>
    </div>
  );
}

/**
 * A response, with its description always visible.
 *
 * Only the schema folds. Previously the description sat next to a ghost
 * "schema" button and the whole row read as chrome; the 4xx prose in this
 * contract is where the errorCode semantics are written down, so it is the
 * part that should never need a click.
 */
function ResponseRow({
  doc,
  code,
  raw,
  anchor,
}: {
  doc: Json;
  code: string;
  raw: Json;
  anchor: string;
}) {
  // The contract expands 200 and 202 by default in redocly.yaml; matching that
  // here keeps the hosted reference and the offline HTML build consistent.
  const [open, setOpen] = useState(code === '200' || code === '202');
  const response = deref(doc, raw);
  const [mediaType, media] = Object.entries<Json>(response?.content ?? {})[0] ?? [];
  const headers = Object.entries<Json>(response?.headers ?? {});

  return (
    <div className={`response ${statusFamily(code)}`} data-open={open}>
      <div className="response-head">
        <span className={`status-code ${statusFamily(code)}`}>{code}</span>
        <div className="response-desc">
          <Markdown className="small">{response?.description}</Markdown>
        </div>
        <Pin anchor={partAnchor(anchor, `responses.${code}`)} label={`${anchor} › ${code}`} />
      </div>

      {headers.length ? (
        <div className="response-headers">
          {headers.map(([name, rawHeader]) => {
            const header = deref(doc, rawHeader);
            return (
              <div className="field-row field-row-tight" key={name}>
                <div className="field-key">
                  <span className="field-name">{name}</span>
                  <span className="field-type">{typeLabel(doc, header?.schema ?? {})}</span>
                  <span className="field-tag">header</span>
                </div>
                {header?.description ? (
                  <div className="field-desc">
                    <InlineMarkdown>{header.description}</InlineMarkdown>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {media ? (
        <>
          <button
            className="disclosure"
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <span className="disclosure-caret" aria-hidden>
              {open ? '▾' : '▸'}
            </span>
            {open ? 'Hide' : 'Show'} response schema
            <span className="sub-meta mono">{mediaType}</span>
          </button>
          {open ? (
            <div className="response-schema">
              <SchemaTree
                doc={doc}
                schema={media.schema}
                anchorBase={anchor}
                anchorPath={`responses.${code}`}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
