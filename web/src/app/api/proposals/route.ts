import { guard, requireContributor } from '@/lib/auth';
import { validateSpec } from '@/lib/openapi';
import { getCurrentSpec } from '@/lib/spec';
import { createProposal, listProposals } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** GET /api/proposals — every edit request, open ones first. */
export async function GET() {
  return guard(async () => {
    return Response.json(
      { proposals: await listProposals() },
      { headers: { 'cache-control': 'no-store' } },
    );
  });
}

/**
 * POST /api/proposals — open an edit request.
 *
 * This is what the editor does for everyone who is not the owner. The proposed
 * YAML is stored on the proposal row and touches the published contract only
 * if and when the owner approves it.
 */
export async function POST(request: Request) {
  return guard(async () => {
    const author = await requireContributor();

    const input = (await request.json()) as { title?: unknown; body?: unknown; yaml?: unknown };

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return Response.json({ error: 'Give the edit request a title.' }, { status: 400 });
    if (typeof input.yaml !== 'string') {
      return Response.json({ error: 'Expected a `yaml` string.' }, { status: 400 });
    }

    // Validated on the way in, not only at approval time, so the author finds
    // out their YAML is broken while they still have it open.
    const result = validateSpec(input.yaml);
    if (!result.ok) {
      return Response.json(
        { error: 'The proposed contract did not validate.', errors: result.errors },
        { status: 422 },
      );
    }

    const current = await getCurrentSpec();
    if (current.yaml === input.yaml) {
      return Response.json(
        { error: 'Nothing changed — this matches the published contract.' },
        { status: 400 },
      );
    }

    const proposal = await createProposal({
      title: title.slice(0, 200),
      body: typeof input.body === 'string' ? input.body.trim().slice(0, 20000) : '',
      yaml: input.yaml,
      // Recorded so the diff on the review page compares against what the
      // author actually started from, even after the contract has moved on.
      baseVersionId: current.version?.id ?? null,
      author,
    });

    return Response.json({ proposal }, { status: 201 });
  });
}
