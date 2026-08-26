import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { getCurrentSpec, getVersionYaml } from '@/lib/spec';
import { getProposal, listProposalComments } from '@/lib/store';
import { getSpecMeta } from '@/lib/specs-registry';
import { ProposalReview } from '@/components/ProposalReview';

export const dynamic = 'force-dynamic';

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ spec: string; id: string }>;
}) {
  const { spec, id: rawId } = await params;
  if (!getSpecMeta(spec)) notFound();
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const proposal = await getProposal(spec, id);
  if (!proposal) notFound();

  const [viewer, current, comments] = await Promise.all([
    getViewer(),
    getCurrentSpec(spec),
    listProposalComments(spec, id),
  ]);

  // Diff against the version the author actually branched from. Falling back
  // to what is published now would show changes the author never made if the
  // contract moved on while this request sat open.
  const baseYaml = proposal.baseVersionId
    ? ((await getVersionYaml(spec, proposal.baseVersionId)) ?? current.yaml)
    : current.yaml;

  return (
    <ProposalReview
      spec={spec}
      proposal={proposal}
      baseYaml={baseYaml}
      currentYaml={current.yaml}
      initialComments={comments}
      viewer={viewer}
    />
  );
}
