'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { DISCUSSION_ANCHOR } from '@/lib/anchors';
import type { Comment, Proposal, Viewer } from '@/lib/types';
import { CommentThreadList } from './CommentThreadList';
import { DiffView } from './DiffView';
import { Markdown } from './Markdown';
import { SpecPreview } from './SpecPreview';
import { Time } from './Time';

type Tab = 'diff' | 'preview' | 'discussion';

/**
 * One edit request: what it changes, what people think of it, and — for the
 * owner alone — the decision.
 */
export function ProposalReview({
  proposal,
  baseYaml,
  currentYaml,
  initialComments,
  viewer,
}: {
  proposal: Proposal;
  /** The version the author started from. */
  baseYaml: string;
  /** What is published right now, which may have moved on since. */
  currentYaml: string;
  initialComments: Comment[];
  viewer: Viewer;
}) {
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  const [tab, setTab] = useState<Tab>('diff');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/comments?proposalId=${proposal.id}`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json()) as { comments: Comment[] };
    setComments(data.comments);
  }, [proposal.id]);

  // The contract may have been edited while this request sat open, in which
  // case approving it silently reverts whatever landed in between.
  const staleBase = baseYaml !== currentYaml;

  async function decide(action: 'approve' | 'reject' | 'withdraw') {
    const confirmations: Record<typeof action, string> = {
      approve: staleBase
        ? 'The contract has changed since this edit request was written. Approving it will replace the published contract with this version, discarding those later changes. Continue?'
        : 'Approve and publish this as the new contract?',
      reject: 'Reject this edit request?',
      withdraw: 'Withdraw this edit request?',
    };
    if (!confirm(confirmations[action])) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError([data.error, ...(data.errors ?? [])].filter(Boolean).join(' · '));
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — nothing was decided.');
    } finally {
      setBusy(false);
    }
  }

  const isOwner = viewer.role === 'owner';
  const isAuthor = viewer.role !== 'guest' && viewer.login === proposal.authorLogin;
  const open = proposal.status === 'open';

  return (
    <main className="page page-wide">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="doc-title" style={{ fontSize: 24 }}>
            {proposal.title}
          </h1>
          <p className="doc-sub small">
            <span className={`pill pill-${proposal.status}`}>{proposal.status}</span>{' '}
            opened by <strong>{proposal.authorLogin}</strong> <Time iso={proposal.createdAt} />
            {proposal.baseVersionId ? ` · from version ${proposal.baseVersionId}` : null}
            {proposal.mergedVersionId ? ` · published as version ${proposal.mergedVersionId}` : null}
          </p>
        </div>
        <a className="btn btn-sm" href="/proposals">
          All edit requests
        </a>
      </div>

      {proposal.body ? (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
          <Markdown>{proposal.body}</Markdown>
        </div>
      ) : null}

      {!open ? (
        <div className="notice">
          <div>
            <strong>{proposal.resolvedBy}</strong> {proposal.status} this
            {proposal.resolvedAt ? (
              <>
                {' '}
                <Time iso={proposal.resolvedAt} />
              </>
            ) : null}
            .
            {proposal.resolutionNote ? <div className="muted">{proposal.resolutionNote}</div> : null}
          </div>
        </div>
      ) : null}

      {open && staleBase ? (
        <div className="notice notice-warn">
          <div>
            <strong>The contract has moved on since this was written.</strong> The diff below
            compares against version {proposal.baseVersionId ?? '—'}, not what is published now.
            Approving replaces the published contract wholesale, so anything that landed in between
            would be lost. Ask the author to rebase — open the editor, reapply, and submit again.
          </div>
        </div>
      ) : null}

      <div className="inline" style={{ margin: '16px 0 12px' }} role="tablist">
        {(['diff', 'preview', 'discussion'] as Tab[]).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={`btn btn-sm${tab === name ? ' btn-primary' : ''}`}
            type="button"
            onClick={() => setTab(name)}
          >
            {name === 'diff'
              ? 'Changes'
              : name === 'preview'
                ? 'Preview'
                : `Discussion (${comments.length})`}
          </button>
        ))}
      </div>

      {tab === 'diff' ? (
        <DiffView
          base={baseYaml}
          next={proposal.yaml ?? ''}
          baseLabel={`version ${proposal.baseVersionId ?? 'repo'}`}
          nextLabel="proposed"
        />
      ) : null}

      {tab === 'preview' ? (
        <div className="card" style={{ padding: '20px 24px' }}>
          <SpecPreview yaml={proposal.yaml ?? ''} />
        </div>
      ) : null}

      {tab === 'discussion' ? (
        <div className="card" style={{ padding: '16px' }}>
          <CommentThreadList
            comments={comments}
            viewer={viewer}
            anchor={DISCUSSION_ANCHOR}
            anchorLabel={`edit request #${proposal.id}`}
            proposalId={proposal.id}
            onChanged={refresh}
            emptyText="No discussion yet."
          />
        </div>
      ) : null}

      {open && (isOwner || isAuthor) ? (
        <div className="card" style={{ padding: '16px', marginTop: 20 }}>
          <div className="sub" style={{ marginTop: 0 }}>
            {isOwner ? 'Decision' : 'Your edit request'}
          </div>

          {error ? <div className="notice notice-error">{error}</div> : null}

          <label className="field">
            <span className="field-label">Note (optional)</span>
            <textarea
              value={note}
              rows={2}
              placeholder={isOwner ? 'Why you are approving or rejecting…' : 'Why you are withdrawing…'}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <div className="inline">
            {isOwner ? (
              <>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => decide('approve')}
                >
                  {busy ? 'Working…' : 'Approve and publish'}
                </button>
                <button className="btn btn-danger" type="button" disabled={busy} onClick={() => decide('reject')}>
                  Reject
                </button>
              </>
            ) : null}
            {isAuthor ? (
              <button className="btn" type="button" disabled={busy} onClick={() => decide('withdraw')}>
                Withdraw
              </button>
            ) : null}
          </div>

          {isOwner ? (
            <p className="field-hint">
              Approving publishes this YAML as the new contract immediately. It is recorded as a new
              version, so it can be read back or reverted from History.
            </p>
          ) : null}
        </div>
      ) : null}

      {open && !isOwner && !isAuthor ? (
        <p className="faint small" style={{ marginTop: 20 }}>
          Only the contract owner can approve an edit request. Add a comment if you have an opinion
          on it.
        </p>
      ) : null}
    </main>
  );
}
