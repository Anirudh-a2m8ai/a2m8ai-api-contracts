'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseSpec, type Json } from '@/lib/openapi';
import {
  INFO_ANCHOR,
  anchorLabel as labelForAnchor,
  countByAnchor,
  opAnchor,
  schemaAnchor,
  tagAnchor,
} from '@/lib/anchors';
import type { Comment, Viewer } from '@/lib/types';
import { CommentProvider } from './comment-context';
import { CommentThreadList } from './CommentThreadList';
import { Markdown } from './Markdown';
import { OperationCard } from './OperationCard';
import { Pin } from './Pin';
import { SchemaTree } from './SchemaTree';

/**
 * The reference itself: navigation, the rendered contract, and the comment
 * rail. Everything a reader can address has a Pin next to it, and selecting
 * one opens that anchor's thread on the right.
 */
export function SpecBrowser({
  yaml,
  initialComments,
  viewer,
  dbReady,
  versionLabel,
  initialAnchor,
}: {
  yaml: string;
  initialComments: Comment[];
  viewer: Viewer;
  dbReady: boolean;
  versionLabel: string;
  /**
   * From `?anchor=` on the server. Passed in rather than read from
   * window.location after mount so that the operation a link points at is
   * already expanded on first render — an effect would run after the cards
   * have mounted collapsed, and their open state is seeded once.
   */
  initialAnchor?: string;
}) {
  // Parsing 160 KiB of YAML is ~50 ms and the string never changes on a given
  // page load, so it happens once rather than on every keystroke in the filter.
  const spec = useMemo(() => parseSpec(yaml), [yaml]);

  const [comments, setComments] = useState(initialComments);
  const [active, setActive] = useState<{ anchor: string; label: string } | null>(() =>
    initialAnchor ? { anchor: initialAnchor, label: labelForAnchor(initialAnchor) } : null,
  );
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch('/api/comments', { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json()) as { comments: Comment[] };
    setComments(data.comments);
  }, []);

  const select = useCallback((anchor: string, label: string) => {
    // Clicking the pin that is already open closes the rail, so it behaves
    // like a toggle rather than trapping the reader in a narrower page.
    setActive((current) => (current?.anchor === anchor ? null : { anchor, label }));
  }, []);

  // Deep links keep the URL in step as the reader moves between threads, so
  // "this exact response code" stays copy-pasteable out of the address bar.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (active) url.searchParams.set('anchor', active.anchor);
    else url.searchParams.delete('anchor');
    window.history.replaceState(null, '', url);
  }, [active]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setActive(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = useMemo(() => countByAnchor(comments), [comments]);
  const context = useMemo(
    () => ({ counts, activeAnchor: active?.anchor ?? null, select }),
    [counts, active, select],
  );

  if (!spec) {
    return (
      <main className="page">
        <div className="notice notice-error">
          <div>
            <strong>The published contract does not parse.</strong> The editor still opens, so it
            can be repaired there.
          </div>
        </div>
      </main>
    );
  }

  const needle = query.trim().toLowerCase();
  const matches = (haystack: string) => !needle || haystack.toLowerCase().includes(needle);

  return (
    <CommentProvider value={context}>
      <div className="shell" data-rail={active ? 'open' : 'closed'}>
        <nav className="sidebar" aria-label="Contract contents">
          <div className="sidebar-search">
            <input
              type="search"
              value={query}
              placeholder="Filter operations…"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Filter operations"
            />
          </div>

          {spec.tags.map((group) => {
            const visible = group.operations.filter(
              (entry) =>
                matches(entry.path) ||
                matches(entry.method) ||
                matches(entry.operation.summary ?? '') ||
                matches(entry.operation.operationId ?? ''),
            );
            if (!visible.length) return null;

            return (
              <div className="sidebar-group" key={group.name}>
                <div className="sidebar-group-title">{group.name}</div>
                {visible.map((entry) => (
                  <a
                    key={`${entry.method}-${entry.path}`}
                    className="sidebar-link"
                    href={`#${operationId(entry.method, entry.path)}`}
                    title={`${entry.method.toUpperCase()} ${entry.path}`}
                  >
                    <span className={`method method-${entry.method}`}>{entry.method}</span>
                    <span className="sidebar-link-text">
                      {entry.operation.summary || entry.path}
                    </span>
                  </a>
                ))}
              </div>
            );
          })}

          {spec.schemas.length ? (
            <div className="sidebar-group">
              <div className="sidebar-group-title">Schemas</div>
              {spec.schemas
                .filter(([name]) => matches(name))
                .map(([name]) => (
                  <a key={name} className="sidebar-link" href={`#schema-${cssId(name)}`}>
                    <span className="sidebar-link-text mono">{name}</span>
                  </a>
                ))}
            </div>
          ) : null}
        </nav>

        <main className="main">
          {!dbReady ? (
            <div className="notice notice-warn">
              <div>
                <strong>Read-only.</strong> No database is attached to this deployment yet, so this
                is the contract committed in the repo and comments cannot be saved. Attach one in
                Vercel under Storage → Create Database → Postgres.
              </div>
            </div>
          ) : null}

          <SetupErrorNotice />

          <header>
            <div className="inline">
              <h1 className="doc-title">{spec.info.title ?? 'API contract'}</h1>
              <Pin anchor={INFO_ANCHOR} label="Overview" />
            </div>
            <p className="doc-sub">
              <span className="pill mono">v{spec.info.version}</span>{' '}
              {spec.info['x-status'] ? <span className="pill">{spec.info['x-status']}</span> : null}{' '}
              {spec.info['x-consumer'] ? (
                <span className="pill">consumer: {spec.info['x-consumer']}</span>
              ) : null}{' '}
              <span className="pill">{versionLabel}</span>
            </p>
            {spec.info.summary ? <p className="muted">{spec.info.summary}</p> : null}
            <Markdown>{spec.info.description}</Markdown>
          </header>

          <Servers doc={spec.doc} />
          <Dependencies doc={spec.doc} />

          {spec.tags.map((group) => (
            <section key={group.name}>
              <h2 className="section-heading" id={`tag-${cssId(group.name)}`}>
                {group.name}
                <Pin anchor={tagAnchor(group.name)} label={group.name} />
              </h2>
              <Markdown>{group.description}</Markdown>
              {group.operations.map((entry) => (
                <OperationCard
                  key={`${entry.method}-${entry.path}`}
                  id={operationId(entry.method, entry.path)}
                  doc={spec.doc}
                  method={entry.method}
                  path={entry.path}
                  operation={entry.operation}
                  defaultOpen={active?.anchor.startsWith(opAnchor(entry.method, entry.path)) ?? false}
                />
              ))}
            </section>
          ))}

          {spec.schemas.length ? (
            <section>
              <h2 className="section-heading" id="schemas">
                Schemas
              </h2>
              {spec.schemas.map(([name, schema]) => (
                <SchemaCard key={name} doc={spec.doc} name={name} schema={schema} />
              ))}
            </section>
          ) : null}
        </main>

        {active ? (
          <aside className="rail" aria-label="Comments">
            <div className="rail-head">
              <div className="rail-title">
                <div className="rail-eyebrow">Comments on</div>
                <div className="rail-anchor">{active.label}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setActive(null)}
                aria-label="Close comments"
              >
                ✕
              </button>
            </div>
            <div className="rail-body">
              {!dbReady ? (
                <div className="notice notice-warn small">
                  Comments need a database. None is attached to this deployment.
                </div>
              ) : (
                <CommentThreadList
                  comments={comments.filter((comment) => comment.anchor === active.anchor)}
                  viewer={viewer}
                  anchor={active.anchor}
                  anchorLabel={active.label}
                  onChanged={refresh}
                  emptyText="Nothing here yet. Be the first to flag something."
                />
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </CommentProvider>
  );
}

/** Surfaces a failed sign-in instead of bouncing the reader back silently. */
function SetupErrorNotice() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('error');
    if (value) setError(value);
  }, []);

  if (!error) return null;

  const MESSAGES: Record<string, string> = {
    'oauth-not-configured':
      'GitHub sign-in is not configured on this deployment. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
    'sign-in-cancelled': 'Sign-in was cancelled.',
    'state-mismatch': 'Sign-in could not be verified. Try again from this tab.',
    'state-invalid': 'Sign-in could not be verified. Try again from this tab.',
    'github-error': 'GitHub could not complete the sign-in. Try again in a moment.',
    'missing-code': 'GitHub did not send back an authorisation code.',
    'no-profile': 'GitHub did not return a username for that account.',
  };

  return (
    <div className={error === 'sign-in-cancelled' ? 'notice' : 'notice notice-error'}>
      <div>{MESSAGES[error] ?? `Sign-in failed: ${error}`}</div>
    </div>
  );
}

function Servers({ doc }: { doc: Json }) {
  const servers: Json[] = doc.servers ?? [];
  if (!servers.length) return null;

  return (
    <div className="card" style={{ padding: '12px 16px', marginTop: 20 }}>
      <div className="sub" style={{ marginTop: 0 }}>
        servers
      </div>
      {servers.map((server: Json, index: number) => (
        <div key={index} className="row">
          <div className="row-main">
            <div className="row-name">{server.url}</div>
            {server.description ? <div className="row-desc">{server.description}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * `x-dependencies` records what the contract presumes but does not deliver.
 * Blocking entries belong at the top of the page, not buried in the YAML.
 */
function Dependencies({ doc }: { doc: Json }) {
  const dependencies: Json[] = doc['x-dependencies'] ?? [];
  if (!dependencies.length) return null;

  const blocking = dependencies.filter((entry: Json) => entry.blocking);

  return (
    <details className="card" style={{ padding: '12px 16px', marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        Dependencies ({dependencies.length})
        {blocking.length ? (
          <span className="pill pill-warn" style={{ marginLeft: 8 }}>
            {blocking.length} blocking
          </span>
        ) : null}
      </summary>
      {dependencies.map((entry: Json, index: number) => (
        <div key={index} className="row">
          <div className="row-main">
            <div className="inline" style={{ gap: 6 }}>
              <span className="row-name">{entry.id ?? entry.title ?? `#${index + 1}`}</span>
              {entry.blocking ? <span className="pill pill-warn">blocking</span> : null}
            </div>
            <div className="row-desc">
              <Markdown className="small">
                {entry.description ?? entry.detail ?? JSON.stringify(entry)}
              </Markdown>
            </div>
          </div>
        </div>
      ))}
    </details>
  );
}

function SchemaCard({ doc, name, schema }: { doc: Json; name: string; schema: Json }) {
  const [open, setOpen] = useState(false);
  const anchor = schemaAnchor(name);

  return (
    <section className="card op" id={`schema-${cssId(name)}`} data-open={open}>
      <div className="op-head">
        <button className="op-toggle" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="op-path">{name}</span>
          <span className="op-summary">{schema?.description ?? ''}</span>
          <span className="faint" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </button>
        <Pin anchor={anchor} label={name} />
      </div>
      {open ? (
        <div className="op-body">
          <Markdown className="small">{schema?.description}</Markdown>
          <SchemaTree doc={doc} schema={schema} anchorBase={anchor} />
        </div>
      ) : null}
    </section>
  );
}

/** A DOM id for an operation. Paths contain slashes and braces; ids cannot. */
function operationId(method: string, path: string): string {
  return `op-${method}-${cssId(path)}`;
}

function cssId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}
