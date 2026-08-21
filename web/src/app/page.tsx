import { getViewer } from '@/lib/auth';
import { isDbConfigured } from '@/lib/db';
import { getCurrentSpec } from '@/lib/spec';
import { listSpecComments } from '@/lib/store';
import { SpecBrowser } from '@/components/SpecBrowser';

// The contract changes whenever the owner saves or approves something, so this
// page is rendered per request rather than cached at build time.
export const dynamic = 'force-dynamic';

export default async function ReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ anchor?: string }>;
}) {
  const [viewer, current, params] = await Promise.all([getViewer(), getCurrentSpec(), searchParams]);
  const comments = await listSpecComments();

  return (
    <SpecBrowser
      yaml={current.yaml}
      initialComments={comments}
      viewer={viewer}
      dbReady={isDbConfigured()}
      initialAnchor={params.anchor}
      versionLabel={current.version ? `version ${current.version.id}` : 'from repo'}
    />
  );
}
