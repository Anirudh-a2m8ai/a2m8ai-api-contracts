import { getViewer, guard, requireOwner } from '@/lib/auth';
import { validateSpec } from '@/lib/openapi';
import { getProposal, mergeProposal, resolveProposal } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/proposals/:id — the edit request including its proposed YAML. */
export async function GET(_request: Request, { params }: Params) {
  return guard(async () => {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: 'Invalid id.' }, { status: 400 });

    const proposal = await getProposal(id);
    if (!proposal) return Response.json({ error: 'No such edit request.' }, { status: 404 });
    return Response.json({ proposal }, { headers: { 'cache-control': 'no-store' } });
  });
}

/**
 * PATCH /api/proposals/:id — decide an edit request.
 *
 *   approve  publish the proposed YAML as a new version   OWNER ONLY
 *   reject   close it without publishing                  OWNER ONLY
 *   withdraw close your own request                       author, or owner
 *
 * `approve` is the one place in the app where somebody else's YAML can reach
 * the published contract, and it takes an explicit owner action to get there.
 */
export async function PATCH(request: Request, { params }: Params) {
  return guard(async () => {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return Response.json({ error: 'Invalid id.' }, { status: 400 });

    const input = (await request.json()) as { action?: unknown; note?: unknown };
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 2000) : '';

    const proposal = await getProposal(id);
    if (!proposal) return Response.json({ error: 'No such edit request.' }, { status: 404 });
    if (proposal.status !== 'open') {
      return Response.json(
        { error: `This edit request was already ${proposal.status}.` },
        { status: 409 },
      );
    }

    if (input.action === 'withdraw') {
      const viewer = await getViewer();
      const isAuthor = viewer.role !== 'guest' && viewer.login === proposal.authorLogin;
      if (!isAuthor) await requireOwner();

      const updated = await resolveProposal({
        id,
        status: 'withdrawn',
        by: viewer.login,
        note,
      });
      if (!updated) return Response.json({ error: 'It was decided already.' }, { status: 409 });
      return Response.json({ proposal: updated });
    }

    const owner = await requireOwner();

    if (input.action === 'reject') {
      const updated = await resolveProposal({ id, status: 'rejected', by: owner.login, note });
      if (!updated) return Response.json({ error: 'It was decided already.' }, { status: 409 });
      return Response.json({ proposal: updated });
    }

    if (input.action === 'approve') {
      // Re-validated at approval time: the proposal may have been sitting open
      // for a while, and this is the last gate before it becomes the contract.
      const yaml = proposal.yaml ?? '';
      const result = validateSpec(yaml);
      if (!result.ok) {
        return Response.json(
          { error: 'This edit request no longer validates and cannot be approved.', errors: result.errors },
          { status: 422 },
        );
      }

      const merged = await mergeProposal({
        id,
        by: owner,
        note,
        message: `Approved edit request #${id}: ${proposal.title}`,
      });
      // null means somebody else decided it between our read and our write.
      if (!merged) return Response.json({ error: 'It was decided already.' }, { status: 409 });

      return Response.json({ proposal: merged.proposal, versionId: merged.versionId });
    }

    return Response.json(
      { error: 'Unknown action. Expected approve, reject or withdraw.' },
      { status: 400 },
    );
  });
}
