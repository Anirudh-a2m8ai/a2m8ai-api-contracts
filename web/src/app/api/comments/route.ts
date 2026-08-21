import { guard, requireContributor } from '@/lib/auth';
import { anchorLabel, isValidAnchor } from '@/lib/anchors';
import { createComment, getComment, listProposalComments, listSpecComments } from '@/lib/store';
import { getProposal } from '@/lib/store';

export const dynamic = 'force-dynamic';

const MAX_BODY = 8000;

/**
 * GET  /api/comments               every comment on the published contract
 * GET  /api/comments?proposalId=3  the discussion on one edit request
 *
 * Readable without signing in — the review trail is part of the documentation.
 */
export async function GET(request: Request) {
  return guard(async () => {
    const proposalId = new URL(request.url).searchParams.get('proposalId');

    const comments = proposalId
      ? await listProposalComments(Number(proposalId))
      : await listSpecComments();

    return Response.json({ comments }, { headers: { 'cache-control': 'no-store' } });
  });
}

/**
 * POST /api/comments — leave a note on a specific part of the contract.
 *
 * This is the route the AI-service team uses. It never touches the contract
 * itself, so it needs nothing more than a signed-in GitHub account.
 */
export async function POST(request: Request) {
  return guard(async () => {
    const author = await requireContributor();

    const input = (await request.json()) as {
      anchor?: unknown;
      anchorLabel?: unknown;
      body?: unknown;
      proposalId?: unknown;
      parentId?: unknown;
    };

    if (!isValidAnchor(input.anchor)) {
      return Response.json({ error: 'That anchor does not name a part of the contract.' }, { status: 400 });
    }

    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body) return Response.json({ error: 'Write something first.' }, { status: 400 });
    if (body.length > MAX_BODY) {
      return Response.json({ error: `Comments are capped at ${MAX_BODY} characters.` }, { status: 400 });
    }

    const proposalId = typeof input.proposalId === 'number' ? input.proposalId : null;
    if (proposalId !== null && !(await getProposal(proposalId))) {
      return Response.json({ error: 'No such edit request.' }, { status: 404 });
    }

    // A reply must belong to the same thread it claims to, or a comment could
    // be smuggled onto an unrelated anchor and render in the wrong place.
    const parentId = typeof input.parentId === 'number' ? input.parentId : null;
    if (parentId !== null) {
      const parent = await getComment(parentId);
      if (!parent) return Response.json({ error: 'No such comment to reply to.' }, { status: 404 });
      if (parent.anchor !== input.anchor || parent.proposalId !== proposalId) {
        return Response.json({ error: 'That reply does not belong to its parent thread.' }, { status: 400 });
      }
      if (parent.parentId !== null) {
        return Response.json({ error: 'Replies are one level deep.' }, { status: 400 });
      }
    }

    const comment = await createComment({
      anchor: input.anchor,
      anchorLabel:
        typeof input.anchorLabel === 'string' && input.anchorLabel.trim()
          ? input.anchorLabel.trim().slice(0, 300)
          : anchorLabel(input.anchor),
      body,
      author,
      proposalId,
      parentId,
    });

    return Response.json({ comment }, { status: 201 });
  });
}
