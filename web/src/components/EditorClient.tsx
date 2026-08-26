'use client';

import Editor, { type OnMount } from '@monaco-editor/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateSpec } from '@/lib/openapi';
import type { Viewer } from '@/lib/types';
import { SpecPreview } from './SpecPreview';

/**
 * The editing surface.
 *
 * One editor, two outcomes, decided entirely by who is signed in: the owner
 * publishes straight to the contract, everyone else opens an edit request that
 * publishes nothing until the owner approves it. The choice is not a toggle the
 * user can flip — the server re-checks on every write, so the UI here only
 * needs to be honest about which of the two is going to happen.
 */
export function EditorClient({
  spec,
  initialYaml,
  viewer,
  dbReady,
  baseVersionLabel,
  ownerLogin,
}: {
  spec: string;
  initialYaml: string;
  viewer: Viewer;
  dbReady: boolean;
  baseVersionLabel: string;
  /** Named in the dialog so a contributor knows who is going to review this. */
  ownerLogin: string | null;
}) {
  const router = useRouter();

  const [yaml, setYaml] = useState(initialYaml);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const dirty = yaml !== initialYaml;
  const isOwner = viewer.role === 'owner';

  // Validation is cheap but not free on 160 KiB, so it trails typing rather
  // than running on every keystroke.
  const [debounced, setDebounced] = useState(yaml);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(yaml), 400);
    return () => clearTimeout(timer);
  }, [yaml]);

  const validation = useMemo(() => validateSpec(debounced), [debounced]);

  // Losing a long edit to a stray Cmd+W is the single worst thing this page
  // could do to someone.
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const proposeDialog = useRef<HTMLDialogElement>(null);

  function openProposeDialog() {
    // Clear any error from a previous attempt so the dialog does not open
    // already complaining about something the author has since fixed.
    setResult(null);
    proposeDialog.current?.showModal();
  }

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Ctrl+S is muscle memory; without this it triggers the browser's
      // "save page as" dialog over the top of the editor.
      document.getElementById('primary-action')?.click();
    });
  };

  const publish = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/specs/${spec}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yaml, message }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setResult({
          kind: 'error',
          text: [data.error, ...(data.errors ?? [])].filter(Boolean).join(' · '),
        });
        return;
      }
      if (data.unchanged) {
        setResult({ kind: 'ok', text: 'Nothing changed — the contract already reads like this.' });
        return;
      }

      setResult({ kind: 'ok', text: `Published as version ${data.version.id}.` });
      setMessage('');
      router.refresh();
    } catch {
      setResult({ kind: 'error', text: 'Network error — nothing was published.' });
    } finally {
      setBusy(false);
    }
  }, [spec, yaml, message, router]);

  const propose = useCallback(async () => {
    if (!title.trim()) {
      setResult({ kind: 'error', text: 'Give the edit request a title first.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/specs/${spec}/proposals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body, yaml }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setResult({
          kind: 'error',
          text: [data.error, ...(data.errors ?? [])].filter(Boolean).join(' · '),
        });
        return;
      }
      // Navigating away is safe now: the work is on the server.
      router.push(`/${spec}/proposals/${data.proposal.id}`);
    } catch {
      setResult({ kind: 'error', text: 'Network error — the edit request was not opened.' });
    } finally {
      setBusy(false);
    }
  }, [spec, title, body, yaml, router]);

  const blocked = !validation.ok || !dirty || busy || !dbReady;

  return (
    <div className="editor-shell">
      <div className="editor-bar">
        <div className="inline" style={{ flex: 1, minWidth: 240 }}>
          <span className="pill">{baseVersionLabel}</span>
          {dirty ? <span className="pill pill-warn">unsaved changes</span> : null}
          {validation.ok ? (
            <span className="pill pill-open">valid</span>
          ) : (
            <span className="pill pill-rejected">
              {validation.errors.length} error{validation.errors.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <button className="btn btn-sm" type="button" onClick={() => setShowPreview(!showPreview)}>
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>

        <button
          className="btn btn-sm"
          type="button"
          disabled={!dirty}
          onClick={() => {
            if (confirm('Discard your changes and reload the published contract?')) {
              setYaml(initialYaml);
              editorRef.current?.setValue(initialYaml);
            }
          }}
        >
          Revert
        </button>

        {viewer.role === 'guest' ? (
          <a
            className="btn btn-primary btn-sm"
            href={`/api/auth/login?returnTo=${encodeURIComponent(`/${spec}/editor`)}`}
          >
            Sign in to propose changes
          </a>
        ) : isOwner ? (
          <>
            <input
              type="text"
              value={message}
              placeholder="What changed? (optional)"
              onChange={(event) => setMessage(event.target.value)}
              style={{ width: 240 }}
              aria-label="Describe what changed"
            />
            <button
              id="primary-action"
              className="btn btn-primary btn-sm"
              type="button"
              onClick={publish}
              disabled={blocked}
              title={!dirty ? 'Nothing has changed yet' : undefined}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          </>
        ) : (
          <button
            id="primary-action"
            className="btn btn-primary btn-sm"
            type="button"
            onClick={openProposeDialog}
            disabled={blocked}
            title={!dirty ? 'Change something first' : undefined}
          >
            Open edit request…
          </button>
        )}
      </div>

      {/*
        Asked for at submit time rather than sitting in a bar above the editor.
        A bare input up there was easy to type past and then be told, on click,
        that a title was required — with no obvious place to put one. A native
        <dialog> also brings focus handling and Escape-to-close with it.
      */}
      <dialog className="dialog" ref={proposeDialog}>
        <h2 className="dialog-title">Open an edit request</h2>
        <p className="dialog-sub">
          Nothing is published yet. {ownerLogin ? <strong>{ownerLogin}</strong> : 'The contract owner'}{' '}
          reviews your diff and decides whether it lands.
        </p>

        <label className="field">
          <span className="field-label">Title</span>
          <input
            type="text"
            value={title}
            autoFocus
            placeholder="e.g. the outline job needs a partial-result field"
            onChange={(event) => setTitle(event.target.value)}
          />
          <span className="field-hint">One line on what this changes.</span>
        </label>

        <label className="field">
          <span className="field-label">Why (optional)</span>
          <textarea
            value={body}
            rows={4}
            placeholder="What problem does this solve? Anything the reviewer should know?"
            onChange={(event) => setBody(event.target.value)}
          />
        </label>

        {result?.kind === 'error' ? <div className="notice notice-error">{result.text}</div> : null}

        <div className="dialog-actions">
          <button className="btn" type="button" onClick={() => proposeDialog.current?.close()}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={propose}
            disabled={busy || !title.trim()}
          >
            {busy ? 'Submitting…' : 'Submit edit request'}
          </button>
        </div>
      </dialog>

      {result ? (
        <div className={`notice ${result.kind === 'ok' ? 'notice-ok' : 'notice-error'}`} style={{ margin: '10px 16px 0' }}>
          <div>{result.text}</div>
        </div>
      ) : null}

      {!dbReady ? (
        <div className="notice notice-warn" style={{ margin: '10px 16px 0' }}>
          <div>
            No database is attached, so nothing can be saved from here. Attach one in Vercel under
            Storage → Create Database → Postgres.
          </div>
        </div>
      ) : null}

      <div className="editor-split" data-preview={showPreview ? 'on' : 'off'}>
        <div className="editor-pane">
          <Editor
            height="100%"
            defaultLanguage="yaml"
            defaultValue={initialYaml}
            onChange={(value) => setYaml(value ?? '')}
            onMount={onMount}
            theme={
              typeof document !== 'undefined' &&
              (document.documentElement.dataset.theme === 'dark' ||
                (!document.documentElement.dataset.theme &&
                  window.matchMedia('(prefers-color-scheme: dark)').matches))
                ? 'vs-dark'
                : 'light'
            }
            options={{
              // Without this Monaco measures its container once, at mount.
              // It sits in a CSS grid cell that has no size yet at that
              // moment, so it latches onto 5x5 and never grows. This installs
              // the ResizeObserver that re-measures.
              automaticLayout: true,
              minimap: { enabled: false },
              wordWrap: 'on',
              tabSize: 2,
              // YAML is whitespace-significant; a stray tab is a parse error
              // that is invisible in the gutter.
              insertSpaces: true,
              renderWhitespace: 'selection',
              scrollBeyondLastLine: false,
              fontSize: 13,
              readOnly: viewer.role === 'guest',
            }}
          />
        </div>

        {showPreview ? (
          <div className="editor-preview">
            <SpecPreview yaml={debounced} />
          </div>
        ) : null}
      </div>

      {validation.errors.length || validation.warnings.length ? (
        <div className="validation">
          {validation.errors.length ? (
            <>
              <strong style={{ color: 'var(--red)' }}>Errors — these block saving</strong>
              <ul>
                {validation.errors.map((error, index) => (
                  <li key={index} style={{ color: 'var(--red)' }}>
                    {error}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {validation.warnings.length ? (
            <>
              <strong style={{ color: 'var(--amber)' }}>
                Warnings — allowed here, but `npm run lint` will reject them
              </strong>
              <ul>
                {validation.warnings.map((warning, index) => (
                  <li key={index} className="muted">
                    {warning}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
