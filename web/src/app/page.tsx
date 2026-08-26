import Link from 'next/link';
import { listSpecs } from '@/lib/specs-registry';
import { CodeBlock } from '@/components/SamplePanel';

export const dynamic = 'force-dynamic';

/**
 * Every 2xx response every contract in this repo returns, regardless of spec
 * or endpoint. Kept in sync by hand with `shared/components/schemas/SuccessEnvelope.yaml`
 * — there is no generated response example that isn't tied to one operation.
 */
const STANDARD_SUCCESS = {
  statusCode: 200,
  code: 'LMS200',
  success: true,
  message: 'Operation completed successfully.',
  data: {
    jobId: 'a91f3c7d-6b28-4e50-9a13-7c4f8b2e0d65',
    status: 'QUEUED',
  },
  meta: null,
  error: null,
};

/** Every non-2xx response, per `shared/components/schemas/ErrorResponse.yaml`. */
const STANDARD_ERROR = {
  statusCode: 400,
  code: 'LMS400',
  success: false,
  message: 'Required request parameter is missing or empty.',
  data: null,
  meta: null,
  error: {
    name: 'MISSING_REQUIRED_FIELD',
    details: "Required field 'documentIds' is missing or empty.",
    fieldErrors: [{ field: 'documentIds', message: 'Field required' }],
  },
};

/** GET / — every spec this app hosts. No DB call: this is registry metadata. */
export default async function SpecIndexPage() {
  const specs = listSpecs();

  return (
    <main className="page">
      <h1 className="doc-title" style={{ fontSize: 26 }}>
        API contracts
      </h1>
      <p className="doc-sub">Pick a spec to read, comment on, or propose a change to.</p>

      <section className="samples samples-panel" style={{ marginBottom: 28 }}>
        <div className="sample-group-head">
          <h4 className="sample-group-title">Standard response format</h4>
          <span className="sample-group-meta">Applies to every endpoint in every contract below</span>
        </div>

        <div className="sample-group">
          <div className="sample-group-head">
            <h4 className="sample-group-title">Success</h4>
          </div>
          <p className="sample-caption">Every 2xx response is wrapped in this envelope.</p>
          <CodeBlock value={STANDARD_SUCCESS} />
        </div>

        <div className="sample-group">
          <div className="sample-group-head">
            <h4 className="sample-group-title">Error</h4>
          </div>
          <p className="sample-caption">
            Every non-2xx response uses this shape. Consumers should branch on{' '}
            <code>error.name</code>, not on <code>message</code> text — see each contract's{' '}
            <code>ErrorCode</code> schema for the full set of names it can return.
          </p>
          <CodeBlock value={STANDARD_ERROR} />
        </div>
      </section>

      <div className="card">
        {specs.map((spec) => (
          <Link className="list-item" key={spec.slug} href={`/${spec.slug}`}>
            <div className="list-title">{spec.name}</div>
            {spec.description ? <div className="list-meta">{spec.description}</div> : null}
          </Link>
        ))}
      </div>
    </main>
  );
}
