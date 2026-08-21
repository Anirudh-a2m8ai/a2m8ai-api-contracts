import { getViewer } from '@/lib/auth';
import { isDbConfigured } from '@/lib/db';
import { getCurrentSpec } from '@/lib/spec';
import { EditorClient } from '@/components/EditorClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit the contract · A2M8 API Contracts' };

/**
 * Open to everyone on purpose.
 *
 * Turning contributors away at the door would mean they can only describe a
 * change in prose; letting them edit and submit means the owner reviews an
 * exact diff. The gate is on publishing, not on typing — see PUT /api/spec.
 */
export default async function EditorPage() {
  const [viewer, current] = await Promise.all([getViewer(), getCurrentSpec()]);

  return (
    <EditorClient
      initialYaml={current.yaml}
      viewer={viewer}
      dbReady={isDbConfigured()}
      ownerLogin={process.env.OWNER_GITHUB_LOGIN?.trim() || null}
      baseVersionLabel={current.version ? `based on version ${current.version.id}` : 'from repo'}
    />
  );
}
