import { getViewer, guard, requireOwner } from '@/lib/auth';
import { deleteComment, getComment, setCommentResolved } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/comments/:id — mark a thread resolved, or reopen it. OWNER ONLY.
 *
 * Resolving is a statement that the point has been dealt with in the contract,
 * which is the owner's call. A contributor who thinks a thread is done says so
 * in a reply.
 */
export async function PATCH(request: Request, { params }: Params) {
  return guard(async () => {
    const owner = await requireOwner();

    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: 'Invalid id.' }, { status: 400 });

    const body = (await request.json()) as { resolved?: unknown };
    if (typeof body.resolved !== 'boolean') {
      return Response.json({ error: 'Expected a `resolved` boolean.' }, { status: 400 });
    }

    const comment = await setCommentResolved(id, body.resolved, owner.login);
    if (!comment) return Response.json({ error: 'No such comment.' }, { status: 404 });
    return Response.json({ comment });
  });
}

/**
 * DELETE /api/comments/:id — the owner may remove anything; everyone else may
 * remove only their own, so a mistyped comment is retractable without needing
 * to ask.
 */
export async function DELETE(_request: Request, { params }: Params) {
  return guard(async () => {
    const viewer = await getViewer();

    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: 'Invalid id.' }, { status: 400 });

    const comment = await getComment(id);
    if (!comment) return Response.json({ error: 'No such comment.' }, { status: 404 });

    const isAuthor = viewer.role !== 'guest' && comment.authorLogin === viewer.login;
    if (!isAuthor) await requireOwner();

    await deleteComment(id);
    return Response.json({ deleted: id });
  });
}
