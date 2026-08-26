import { getViewer, guard, requireOwner } from '@/lib/auth';
import { deleteComment, getComment, setCommentResolved } from '@/lib/store';
import { getSpecMeta } from '@/lib/specs-registry';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ spec: string; id: string }> };

/**
 * PATCH /api/specs/:spec/comments/:id — mark a thread resolved, or reopen it. OWNER ONLY.
 *
 * Resolving is a statement that the point has been dealt with in the contract,
 * which is the owner's call. A contributor who thinks a thread is done says so
 * in a reply.
 */
export async function PATCH(request: Request, { params }: Params) {
  return guard(async () => {
    const { spec, id: rawId } = await params;
    if (!getSpecMeta(spec)) return Response.json({ error: 'No such spec.' }, { status: 404 });

    const owner = await requireOwner();

    const id = Number(rawId);
    if (!Number.isInteger(id)) return Response.json({ error: 'Invalid id.' }, { status: 400 });

    const body = (await request.json()) as { resolved?: unknown };
    if (typeof body.resolved !== 'boolean') {
      return Response.json({ error: 'Expected a `resolved` boolean.' }, { status: 400 });
    }

    const comment = await setCommentResolved(spec, id, body.resolved, owner.login);
    if (!comment) return Response.json({ error: 'No such comment.' }, { status: 404 });
    return Response.json({ comment });
  });
}

/**
 * DELETE /api/specs/:spec/comments/:id — the owner may remove anything; everyone
 * else may remove only their own, so a mistyped comment is retractable without
 * needing to ask.
 */
export async function DELETE(_request: Request, { params }: Params) {
  return guard(async () => {
    const { spec, id: rawId } = await params;
    if (!getSpecMeta(spec)) return Response.json({ error: 'No such spec.' }, { status: 404 });

    const viewer = await getViewer();

    const id = Number(rawId);
    if (!Number.isInteger(id)) return Response.json({ error: 'Invalid id.' }, { status: 400 });

    const comment = await getComment(spec, id);
    if (!comment) return Response.json({ error: 'No such comment.' }, { status: 404 });

    const isAuthor = viewer.role !== 'guest' && comment.authorLogin === viewer.login;
    if (!isAuthor) await requireOwner();

    await deleteComment(spec, id);
    return Response.json({ deleted: id });
  });
}
