'use client';

import { useMemo } from 'react';
import { parseSpec } from '@/lib/openapi';
import { INERT_COMMENTS, CommentProvider } from './comment-context';
import { Markdown } from './Markdown';
import { OperationCard } from './OperationCard';

/**
 * The rendered form of whatever is currently in the editor.
 *
 * Deliberately the same OperationCard the reference page uses, so what the
 * author sees while editing is what readers will see — a separate preview
 * renderer would drift from the real one.
 */
export function SpecPreview({ yaml }: { yaml: string }) {
  const spec = useMemo(() => parseSpec(yaml), [yaml]);

  if (!spec) {
    return <p className="empty">Nothing to preview — the YAML does not parse yet.</p>;
  }

  return (
    <CommentProvider value={INERT_COMMENTS}>
      <h1 className="doc-title">{spec.info.title ?? 'API contract'}</h1>
      <div className="doc-meta">
        <span className="pill mono">v{spec.info.version}</span>
        {spec.info['x-status'] ? <span className="pill">{spec.info['x-status']}</span> : null}
      </div>
      <Markdown className="op-prose">{spec.info.description}</Markdown>

      {spec.tags.map((group) => (
        <section key={group.name}>
          <h2 className="section-heading">{group.name}</h2>
          <Markdown className="op-prose">{group.description}</Markdown>
          {group.operations.map((entry) => (
            <OperationCard
              key={`${entry.method}-${entry.path}`}
              id={`preview-${entry.method}-${entry.path}`}
              doc={spec.doc}
              method={entry.method}
              path={entry.path}
              operation={entry.operation}
            />
          ))}
        </section>
      ))}
    </CommentProvider>
  );
}
