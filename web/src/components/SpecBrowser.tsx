'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deref, parseSpec, type Json } from '@/lib/openapi';
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
import { CodeBlock } from './SamplePanel';
import { SchemaTree } from './SchemaTree';
import { schemaSample } from '@/lib/sample';

/**
 * The reference itself: navigation, the rendered contract, and the comment
 * rail. Everything a reader can address has a Pin next to it, and selecting
 * one opens that anchor's thread on the right.
 */
export function SpecBrowser({
  spec,
  yaml,
  initialComments,
  viewer,
  dbReady,
  versionLabel,
  initialAnchor,
}: {
  spec: string;
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
  const parsed = useMemo(() => parseSpec(yaml), [yaml]);

  const [comments, setComments] = useState(initialComments);
  const [active, setActive] = useState<{ anchor: string; label: string } | null>(() =>
    initialAnchor ? { anchor: initialAnchor, label: labelForAnchor(initialAnchor) } : null,
  );
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/specs/${spec}/comments`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json()) as { comments: Comment[] };
    setComments(data.comments);
  }, [spec]);

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

  const here = useScrollSpy();

  if (!parsed) {
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

          {/*
            The overview runs to a couple of screens, so without an entry of
            its own the sidebar reads as having nothing selected for as long
            as anyone spends reading it.
          */}
          <div className="sidebar-group">
            <a className="sidebar-link" href="#overview" data-active={here === 'overview'}>
              <span className="sidebar-link-text">Overview</span>
            </a>
          </div>

          {parsed.tags.map((group) => {
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
                <a className="sidebar-group-title" href={`#tag-${cssId(group.name)}`}>
                  {group.name}
                </a>
                {visible.map((entry) => {
                  const id = operationId(entry.method, entry.path);
                  return (
                    <a
                      key={`${entry.method}-${entry.path}`}
                      className="sidebar-link"
                      href={`#${id}`}
                      data-active={here === id}
                      title={`${entry.method.toUpperCase()} ${entry.path}`}
                    >
                      <span className={`method method-${entry.method}`}>{entry.method}</span>
                      <span className="sidebar-link-text">
                        {entry.operation.summary || entry.path}
                      </span>
                    </a>
                  );
                })}
              </div>
            );
          })}

          {parsed.schemas.length ? (
            <div className="sidebar-group">
              <a className="sidebar-group-title" href="#schemas">
                Schemas
              </a>
              {parsed.schemas
                .filter(([name]) => matches(name))
                .map(([name]) => {
                  const id = `schema-${cssId(name)}`;
                  return (
                    <a key={name} className="sidebar-link" href={`#${id}`} data-active={here === id}>
                      <span className="sidebar-link-text mono">{name}</span>
                    </a>
                  );
                })}
            </div>
          ) : null}
        </nav>

        <main className="main">
          <div className="main-inner">
            {!dbReady ? (
              <div className="notice notice-warn">
                <div>
                  <strong>Read-only.</strong> No database is attached to this deployment yet, so
                  this is the contract committed in the repo and comments cannot be saved. Attach
                  one in Vercel under Storage → Create Database → Postgres.
                </div>
              </div>
            ) : null}

            <SetupErrorNotice />

            <header className="doc-head" id="overview">
              <div className="doc-head-row">
                <h1 className="doc-title">{parsed.info.title ?? 'API contract'}</h1>
                <Pin anchor={INFO_ANCHOR} label="Overview" />
              </div>
              <div className="doc-meta">
                <span className="pill mono">v{parsed.info.version}</span>
                {parsed.info['x-status'] ? (
                  <span className="pill">{parsed.info['x-status']}</span>
                ) : null}
                {parsed.info['x-consumer'] ? (
                  <span className="pill">consumer: {parsed.info['x-consumer']}</span>
                ) : null}
                <span className="pill">{versionLabel}</span>
              </div>
              {parsed.info.summary ? <p className="doc-lede">{parsed.info.summary}</p> : null}
            </header>

            <Servers doc={parsed.doc} />

            <Markdown className="op-prose">{parsed.info.description}</Markdown>

            <Dependencies doc={parsed.doc} />

            {parsed.tags.map((group) => (
              <section key={group.name}>
                <h2 className="section-heading" id={`tag-${cssId(group.name)}`}>
                  {group.name}
                  <Pin anchor={tagAnchor(group.name)} label={group.name} />
                </h2>
                <Markdown className="op-prose">{group.description}</Markdown>
                {group.operations.map((entry) => (
                  <OperationCard
                    key={`${entry.method}-${entry.path}`}
                    id={operationId(entry.method, entry.path)}
                    doc={parsed.doc}
                    method={entry.method}
                    path={entry.path}
                    operation={entry.operation}
                  />
                ))}
              </section>
            ))}

            {parsed.schemas.length ? (
              <section>
                <h2 className="section-heading" id="schemas">
                  Schemas
                </h2>
                <p className="doc-lede">
                  The shapes the operations above are built from. Every one is reachable from at
                  least one endpoint.
                </p>
                <div className="schema-list">
                  {parsed.schemas.map(([name, schema]) => (
                    <SchemaCard key={name} doc={parsed.doc} name={name} schema={schema} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
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
                  spec={spec}
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

/**
 * Which section the reader is currently in, for the sidebar highlight.
 *
 * A scroll listener rather than an IntersectionObserver: most of this page is
 * collapsed schema cards, so at any moment dozens of targets intersect the
 * viewport at once and picking between them costs as much as this does. The
 * answer wanted is simply the last heading scrolled past.
 */
function useScrollSpy(): string | null {
  const [id, setId] = useState<string | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    function measure() {
      frame.current = 0;
      const targets = document.querySelectorAll<HTMLElement>(
        '.doc-head[id], .section-heading[id], .op[id]',
      );
      // A little below the sticky header, so a heading counts as "current"
      // from the moment it settles under it rather than when it leaves.
      const line = 140;
      let found: string | null = null;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= line) found = target.id;
        else break;
      }
      setId(found);
    }

    function onScroll() {
      if (frame.current) return;
      frame.current = requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return id;
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
    <div className="servers">
      <span className="servers-label">Base URL</span>
      {servers.map((server: Json, index: number) => (
        <div className="server" key={index}>
          <code className="server-url">{server.url}</code>
          {server.description ? <span className="server-desc">{server.description}</span> : null}
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
    <details className="callout" open={blocking.length > 0}>
      <summary className="callout-summary">
        <span className="callout-caret" aria-hidden>
          ▸
        </span>
        Dependencies
        <span className="pill">{dependencies.length}</span>
        {blocking.length ? <span className="pill pill-warn">{blocking.length} blocking</span> : null}
      </summary>
      <div className="callout-body">
        {dependencies.map((entry: Json, index: number) => (
          <div className="field-row" key={index}>
            <div className="field-key">
              <span className="field-name">{entry.id ?? entry.title ?? `#${index + 1}`}</span>
              {entry.blocking ? <span className="pill pill-warn">blocking</span> : null}
            </div>
            <Markdown className="field-desc small">
              {entry.description ?? entry.detail ?? JSON.stringify(entry)}
            </Markdown>
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * A schema on its own, collapsed.
 *
 * Unlike the operations there are seventy-odd of these, so the list has to
 * stay scannable — the summary line carries the description, and opening one
 * shows the field list beside a sample of the shape.
 */
function SchemaCard({ doc, name, schema }: { doc: Json; name: string; schema: Json }) {
  const [open, setOpen] = useState(false);
  const anchor = schemaAnchor(name);
  const resolved = deref(doc, schema);
  const sample = open ? schemaSample(doc, schema) : undefined;

  return (
    <section className="op op-schema" id={`schema-${cssId(name)}`} data-open={open}>
      <div className="op-head">
        <button
          className="op-toggle"
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="op-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <span className="op-path">{name}</span>
          {resolved?.description ? (
            <span className="op-summary">{firstLine(resolved.description)}</span>
          ) : null}
        </button>
        <Pin anchor={anchor} label={name} />
      </div>
      {open ? (
        <div className="op-body">
          <div className="op-docs">
            <Markdown className="op-prose">{resolved?.description}</Markdown>
            <SchemaTree doc={doc} schema={schema} anchorBase={anchor} />
          </div>
          <div className="op-samples">
            <div className="op-samples-inner">
              {sample === undefined ? null : (
                <div className="samples">
                  <section className="sample-group">
                    <div className="sample-group-head">
                      <h4 className="sample-group-title">Shape</h4>
                    </div>
                    <CodeBlock value={sample} />
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The lead sentence of a description, for a one-line summary slot. */
function firstLine(description: string): string {
  return description.split('\n')[0];
}

/** A DOM id for an operation. Paths contain slashes and braces; ids cannot. */
function operationId(method: string, path: string): string {
  return `op-${method}-${cssId(path)}`;
}

function cssId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}
