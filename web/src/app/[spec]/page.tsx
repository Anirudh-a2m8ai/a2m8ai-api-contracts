import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { isDbConfigured } from '@/lib/db';
import { getCurrentSpec } from '@/lib/spec';
import { listSpecComments } from '@/lib/store';
import { getSpecMeta } from '@/lib/specs-registry';
import { SpecBrowser } from '@/components/SpecBrowser';

// The contract changes whenever the owner saves or approves something, so this
// page is rendered per request rather than cached at build time.
export const dynamic = 'force-dynamic';

export default async function ReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ spec: string }>;
  searchParams: Promise<{ anchor?: string }>;
}) {
  const { spec } = await params;
  // The layout above already 404s an unknown slug, but Next renders sibling
  // segments concurrently — repeating the check here avoids a wasted (and
  // noisy) data fetch racing that redirect, e.g. for a stray /favicon.ico
  // request landing in this catch-all segment.
  if (!getSpecMeta(spec)) notFound();
  const [viewer, current, query] = await Promise.all([getViewer(), getCurrentSpec(spec), searchParams]);
  const comments = await listSpecComments(spec);

  return (
    <SpecBrowser
      spec={spec}
      yaml={current.yaml}
      initialComments={comments}
      viewer={viewer}
      dbReady={isDbConfigured()}
      initialAnchor={query.anchor}
      versionLabel={current.version ? `version ${current.version.id}` : 'from repo'}
    />
  );
}
