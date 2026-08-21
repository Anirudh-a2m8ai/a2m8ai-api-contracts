import type { Comment, CommentThread } from './types';

/**
 * Nests replies under their parent, both ordered oldest first.
 *
 * Pure, and in its own module rather than in store.ts, because the client
 * components need it — importing it from store.ts would drag the Postgres
 * driver into the browser bundle.
 */
export function threadComments(comments: Comment[]): CommentThread[] {
  const roots: CommentThread[] = [];
  const byId = new Map<number, CommentThread>();

  for (const comment of comments) {
    if (comment.parentId === null) {
      const thread: CommentThread = { ...comment, replies: [] };
      byId.set(comment.id, thread);
      roots.push(thread);
    }
  }

  for (const comment of comments) {
    if (comment.parentId === null) continue;
    // A reply whose parent was deleted is promoted to a root rather than
    // dropped — losing a reviewer's note silently is the worse failure.
    const parent = byId.get(comment.parentId);
    if (parent) parent.replies.push(comment);
    else roots.push({ ...comment, replies: [] });
  }

  return roots;
}
