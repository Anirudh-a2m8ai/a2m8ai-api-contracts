'use client';

import { useState } from 'react';
import type { Json } from '@/lib/openapi';
import { deref } from '@/lib/openapi';
import { mediaExamples, tokenizeJson, tokensToText, type NamedExample } from '@/lib/sample';

/**
 * The payload column: what goes over the wire, beside the prose that describes
 * it.
 *
 * The contract's examples were already in the YAML — they were just three
 * clicks deep behind a <details> that showed only the first of them. Reading a
 * field list and its payload at the same time is most of what makes a
 * reference scannable, so they sit side by side and stay open.
 */
export function SamplePanel({
  doc,
  operation,
  method,
  path,
}: {
  doc: Json;
  operation: Json;
  method: string;
  path: string;
}) {
  const body = deref(doc, operation.requestBody);
  const [requestType, requestMedia] = Object.entries<Json>(body?.content ?? {})[0] ?? [];
  const requestSamples = requestMedia ? mediaExamples(doc, requestMedia) : [];

  const responses = Object.entries<Json>(operation.responses ?? {})
    .map(([code, raw]) => {
      const response = deref(doc, raw);
      const [mediaType, media] = Object.entries<Json>(response?.content ?? {})[0] ?? [];
      return { code, response, mediaType, samples: media ? mediaExamples(doc, media) : [] };
    })
    .filter((entry) => entry.samples.length > 0);

  if (!requestSamples.length && !responses.length) return null;

  return (
    <div className="samples">
      <div className="sample-endpoint">
        <span className={`method method-${method}`}>{method}</span>
        <span className="sample-endpoint-path">{path}</span>
      </div>

      {requestSamples.length ? (
        <SampleGroup
          title="Request sample"
          meta={requestType}
          samples={requestSamples}
          tabLabel={(sample) => sample.name}
        />
      ) : null}

      {responses.length ? (
        <ResponseSamples responses={responses} />
      ) : null}
    </div>
  );
}

interface ResponseEntry {
  code: string;
  response: Json;
  mediaType: string;
  samples: NamedExample[];
}

/**
 * Response codes as tabs.
 *
 * Every code an operation can return is on screen at once. In the old layout
 * they were rows to be expanded one at a time, which is the wrong shape for
 * the question a reader actually has here — "what do the failures look like?"
 */
function ResponseSamples({ responses }: { responses: ResponseEntry[] }) {
  const [code, setCode] = useState(responses[0].code);
  const active = responses.find((entry) => entry.code === code) ?? responses[0];

  return (
    <section className="sample-group">
      <div className="sample-group-head">
        <h4 className="sample-group-title">Response samples</h4>
        <span className="sample-group-meta mono">{active.mediaType}</span>
      </div>

      <div className="sample-tabs" role="tablist" aria-label="Response status codes">
        {responses.map((entry) => (
          <button
            key={entry.code}
            type="button"
            role="tab"
            aria-selected={entry.code === active.code}
            className={`sample-tab status-tab ${statusFamily(entry.code)}`}
            data-active={entry.code === active.code}
            onClick={() => setCode(entry.code)}
          >
            {entry.code}
          </button>
        ))}
      </div>

      <SampleBody
        key={active.code}
        samples={active.samples}
        tabLabel={(sample) => sample.summary ?? sample.name}
      />
    </section>
  );
}

function SampleGroup({
  title,
  meta,
  samples,
  tabLabel,
}: {
  title: string;
  meta?: string;
  samples: NamedExample[];
  tabLabel: (sample: NamedExample) => string;
}) {
  return (
    <section className="sample-group">
      <div className="sample-group-head">
        <h4 className="sample-group-title">{title}</h4>
        {meta ? <span className="sample-group-meta mono">{meta}</span> : null}
      </div>
      <SampleBody samples={samples} tabLabel={tabLabel} />
    </section>
  );
}

/** The variant picker plus the code block itself. */
function SampleBody({
  samples,
  tabLabel,
}: {
  samples: NamedExample[];
  tabLabel: (sample: NamedExample) => string;
}) {
  const [index, setIndex] = useState(0);
  const sample = samples[Math.min(index, samples.length - 1)];

  return (
    <>
      {samples.length > 1 ? (
        <div className="sample-tabs sample-tabs-variant" role="tablist" aria-label="Example">
          {samples.map((entry, position) => (
            <button
              key={entry.name}
              type="button"
              role="tab"
              aria-selected={position === index}
              className="sample-tab"
              data-active={position === index}
              onClick={() => setIndex(position)}
              title={entry.description ?? entry.summary ?? entry.name}
            >
              {tabLabel(entry)}
            </button>
          ))}
        </div>
      ) : null}

      {samples.length === 1 && sample.summary ? (
        <p className="sample-caption">{sample.summary}</p>
      ) : null}

      {sample.generated ? (
        <p className="sample-caption sample-caption-generated">
          Generated from the schema — the contract carries no example here.
        </p>
      ) : null}

      <CodeBlock value={sample.value} />
    </>
  );
}

/** Pretty-printed JSON, coloured from the value rather than from its text. */
export function CodeBlock({ value }: { value: Json }) {
  const tokens = tokenizeJson(value);

  return (
    <div className="code-block">
      <CopyButton text={() => tokensToText(tokens)} />
      <pre className="code-json">
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={`j-${token.kind}`}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/**
 * `text` is a thunk so the (potentially large) JSON is only flattened when
 * somebody actually clicks, not on every render of every operation.
 */
function CopyButton({ text }: { text: () => string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // A denied clipboard permission is not worth an error state; the sample
      // is on screen and selectable either way.
    }
  }

  return (
    <button className="code-copy" type="button" onClick={copy} aria-label="Copy to clipboard">
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

export function statusFamily(code: string): string {
  if (code.startsWith('2')) return 'status-2xx';
  if (code.startsWith('3')) return 'status-3xx';
  if (code.startsWith('4')) return 'status-4xx';
  if (code.startsWith('5')) return 'status-5xx';
  return '';
}
