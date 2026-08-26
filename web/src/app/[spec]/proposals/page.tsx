import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { isDbConfigured } from '@/lib/db';
import { listProposals } from '@/lib/store';
import { getSpecMeta } from '@/lib/specs-registry';
import { Time } from '@/components/Time';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit requests · A2M8 API Contracts' };

export default async function ProposalsPage({ params }: { params: Promise<{ spec: string }> }) {
  const { spec } = await params;
  if (!getSpecMeta(spec)) notFound();
  const [viewer, proposals] = await Promise.all([getViewer(), listProposals(spec)]);

  const open = proposals.filter((proposal) => proposal.status === 'open');

  return (
    <main className="page">
      <div className="spread">
        <div>
          <h1 className="doc-title" style={{ fontSize: 26 }}>
            Edit requests
          </h1>
          <p className="doc-sub">
            Proposed changes to the contract. {open.length} awaiting a decision.
          </p>
        </div>
        <Link className="btn btn-primary" href={`/${spec}/editor`}>
          Propose a change
        </Link>
      </div>

      {!isDbConfigured() ? (
        <div className="notice notice-warn">
          <div>
            No database is attached to this deployment, so edit requests cannot be stored. Attach one
            in Vercel under Storage → Create Database → Postgres.
          </div>
        </div>
      ) : null}

      {viewer.role === 'owner' && open.length ? (
        <div className="notice notice-info">
          <div>
            {open.length} edit request{open.length === 1 ? '' : 's'} waiting on you. Nothing changes
            in the contract until you approve.
          </div>
        </div>
      ) : null}

      <div className="card">
        {proposals.length === 0 ? (
          <p className="empty">
            No edit requests yet. Anyone signed in can open one from the{' '}
            <Link href={`/${spec}/editor`}>editor</Link>.
          </p>
        ) : (
          proposals.map((proposal) => (
            <Link className="list-item" key={proposal.id} href={`/${spec}/proposals/${proposal.id}`}>
              <div className="inline">
                <span className={`pill pill-${proposal.status}`}>{proposal.status}</span>
                <span className="list-title">{proposal.title}</span>
              </div>
              <div className="list-meta">
                #{proposal.id} · {proposal.authorLogin} · <Time iso={proposal.createdAt} />
                {proposal.commentCount ? ` · ${proposal.commentCount} comments` : null}
                {proposal.mergedVersionId ? ` · published as version ${proposal.mergedVersionId}` : null}
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
