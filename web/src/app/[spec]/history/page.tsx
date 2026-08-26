import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { isDbConfigured } from '@/lib/db';
import { listVersions } from '@/lib/spec';
import { getSpecMeta } from '@/lib/specs-registry';
import { Time } from '@/components/Time';
import { VersionActions } from '@/components/VersionActions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'History · A2M8 API Contracts' };

export default async function HistoryPage({ params }: { params: Promise<{ spec: string }> }) {
  const { spec } = await params;
  if (!getSpecMeta(spec)) notFound();
  const [viewer, versions] = await Promise.all([getViewer(), listVersions(spec)]);

  return (
    <main className="page">
      <h1 className="doc-title" style={{ fontSize: 26 }}>
        History
      </h1>
      <p className="doc-sub">
        Every published state of the contract, newest first. Nothing is overwritten, so any version
        can be read back or restored.
      </p>

      {!isDbConfigured() ? (
        <div className="notice notice-warn">
          <div>
            No database is attached, so there is no history to show — the site is serving the
            contract committed in the repo.
          </div>
        </div>
      ) : null}

      <div className="card">
        {versions.length === 0 ? (
          <p className="empty">No versions recorded yet.</p>
        ) : (
          versions.map((version, index) => (
            <div className="list-item" key={version.id}>
              <div className="spread">
                <div style={{ minWidth: 0 }}>
                  <div className="inline">
                    <span className="pill mono">version {version.id}</span>
                    {index === 0 ? <span className="pill pill-open">current</span> : null}
                    {version.fromProposal ? (
                      <Link className="pill pill-merged" href={`/${spec}/proposals/${version.fromProposal}`}>
                        from edit request #{version.fromProposal}
                      </Link>
                    ) : null}
                  </div>
                  <div className="list-title" style={{ fontWeight: 500, fontSize: 14 }}>
                    {version.message || 'No message'}
                  </div>
                  <div className="list-meta">
                    {version.authorLogin} · <Time iso={version.createdAt} />
                  </div>
                </div>
                {viewer.role === 'owner' ? (
                  <VersionActions spec={spec} versionId={version.id} isCurrent={index === 0} />
                ) : (
                  <a className="btn btn-ghost btn-sm" href={`/api/specs/${spec}/versions?id=${version.id}`}>
                    View YAML
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="faint small" style={{ marginTop: 16 }}>
        The published contract is also available raw at{' '}
        <a href={`/api/specs/${spec}`}>/api/specs/{spec}</a> (YAML) and{' '}
        <a href={`/api/specs/${spec}?format=json`}>/api/specs/{spec}?format=json</a> for codegen.
      </p>
    </main>
  );
}
