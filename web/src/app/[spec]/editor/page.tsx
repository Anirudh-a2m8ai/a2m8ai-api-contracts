import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { isDbConfigured } from '@/lib/db';
import { getCurrentSpec } from '@/lib/spec';
import { getSpecMeta } from '@/lib/specs-registry';
import { EditorClient } from '@/components/EditorClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit the contract · A2M8 API Contracts' };

/**
 * Open to everyone on purpose.
 *
 * Turning contributors away at the door would mean they can only describe a
 * change in prose; letting them edit and submit means the owner reviews an
 * exact diff. The gate is on publishing, not on typing — see PUT /api/specs/:spec.
 */
export default async function EditorPage({ params }: { params: Promise<{ spec: string }> }) {
  const { spec } = await params;
  if (!getSpecMeta(spec)) notFound();
  const [viewer, current] = await Promise.all([getViewer(), getCurrentSpec(spec)]);

  return (
    <EditorClient
      spec={spec}
      initialYaml={current.yaml}
      viewer={viewer}
      dbReady={isDbConfigured()}
      ownerLogin={process.env.OWNER_GITHUB_LOGIN?.trim() || null}
      baseVersionLabel={current.version ? `based on version ${current.version.id}` : 'from repo'}
    />
  );
}
