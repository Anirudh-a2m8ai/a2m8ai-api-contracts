'use client';

import { useState } from 'react';
import { threadComments } from '@/lib/thread';
import type { Comment, Viewer } from '@/lib/types';
import { Markdown } from './Markdown';
import { Time } from './Time';

/**
 * Threads plus composer, shared by the reference rail and the edit-request
 * page. Every mutation re-reads from the server via `onChanged` rather than
 * patching local state, so two people reviewing at once converge instead of
 * drifting.
 */
export function CommentThreadList({
  comments,
  viewer,
  anchor,
  anchorLabel,
  proposalId = null,
  onChanged,
  emptyText = 'No comments here yet.',
}: {
  comments: Comment[];
  viewer: Viewer;
  anchor: string;
  anchorLabel: string;
  proposalId?: number | null;
  onChanged: () => void;
  emptyText?: string;
}) {
  const threads = threadComments(comments);

  return (
    <div>
      {threads.length === 0 ? <p className="empty">{emptyText}</p> : null}

      {threads.map((thread) => (
        <article className="thread" key={thread.id} data-resolved={thread.resolved}>
          <CommentBody comment={thread} viewer={viewer} onChanged={onChanged} canResolve />

          {thread.replies.length ? (
            <div className="replies">
              {thread.replies.map((reply) => (
                <div className="reply" key={reply.id}>
                  <CommentBody comment={reply} viewer={viewer} onChanged={onChanged} />
                </div>
              ))}
            </div>
          ) : null}

          {viewer.role !== 'guest' ? (
            <Composer
              anchor={anchor}
              anchorLabel={anchorLabel}
              proposalId={proposalId}
              parentId={thread.id}
              onChanged={onChanged}
              placeholder="Reply…"
              compact
            />
          ) : null}
        </article>
      ))}

      {viewer.role === 'guest' ? (
        <SignInPrompt />
      ) : (
        <Composer
          anchor={anchor}
          anchorLabel={anchorLabel}
          proposalId={proposalId}
          parentId={null}
          onChanged={onChanged}
          placeholder={
            proposalId
              ? 'Add to the discussion…'
              : `What needs to change about ${anchorLabel}?`
          }
        />
      )}
    </div>
  );
}

function SignInPrompt() {
  return (
    <div className="notice notice-info">
      <div>
        <a href={`/api/auth/login?returnTo=${encodeURIComponent(currentPath())}`}>Sign in with GitHub</a>{' '}
        to leave a comment. Reading needs no account.
      </div>
    </div>
  );
}

/** Current path, for bouncing the reader back here after the OAuth round trip. */
function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname + window.location.search;
}

function CommentBody({
  comment,
  viewer,
  onChanged,
  canResolve = false,
}: {
  comment: Comment;
  viewer: Viewer;
  onChanged: () => void;
  canResolve?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const isOwner = viewer.role === 'owner';
  const isAuthor = viewer.role !== 'guest' && viewer.login === comment.authorLogin;

  async function act(method: 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true);
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Request failed.' }));
        alert(data.error ?? 'Request failed.');
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="comment-head">
        {comment.authorAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar avatar-sm" src={comment.authorAvatar} alt="" width={22} height={22} />
        ) : null}
        <span className="comment-author">{comment.authorLogin}</span>
        <Time iso={comment.createdAt} />
        {comment.resolved ? <span className="pill pill-merged">resolved</span> : null}
      </div>

      <div className="comment-body">
        <Markdown>{comment.body}</Markdown>
      </div>

      {isOwner || isAuthor ? (
        <div className="comment-actions">
          {canResolve && isOwner ? (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={busy}
              onClick={() => act('PATCH', { resolved: !comment.resolved })}
            >
              {comment.resolved ? 'Reopen' : 'Mark resolved'}
            </button>
          ) : null}
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm('Delete this comment? Replies to it go too.')) act('DELETE');
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Composer({
  anchor,
  anchorLabel,
  proposalId,
  parentId,
  onChanged,
  placeholder,
  compact = false,
}: {
  anchor: string;
  anchorLabel: string;
  proposalId: number | null;
  parentId: number | null;
  onChanged: () => void;
  placeholder: string;
  compact?: boolean;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A reply box under every thread would drown the rail; it opens on demand.
  const [expanded, setExpanded] = useState(!compact);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ anchor, anchorLabel, body, proposalId, parentId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? 'Could not post that comment.');
        return;
      }
      setBody('');
      if (compact) setExpanded(false);
      onChanged();
    } catch {
      setError('Network error — the comment was not posted.');
    } finally {
      setBusy(false);
    }
  }

  if (!expanded) {
    return (
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setExpanded(true)}>
        Reply
      </button>
    );
  }

  return (
    <div className="composer">
      <textarea
        value={body}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Enter alone inserts a newline — these are prose comments, and
          // people paste multi-line YAML into them.
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
        }}
        rows={compact ? 2 : 3}
      />
      {error ? <div className="notice notice-error small">{error}</div> : null}
      <div className="composer-actions">
        <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? 'Posting…' : 'Comment'}
        </button>
        {compact ? (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setExpanded(false)}>
            Cancel
          </button>
        ) : null}
        <span className="faint small">Markdown · ⌘/Ctrl + Enter to post</span>
      </div>
    </div>
  );
}
