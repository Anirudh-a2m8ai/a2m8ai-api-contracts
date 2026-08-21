'use client';

import { useMemo, useState } from 'react';
import { structuredPatch } from 'diff';

/**
 * A unified diff of the proposed contract against the version it was written
 * from.
 *
 * This is the thing the owner actually decides on. Rendering the whole 3,700-line
 * file with changes buried in it would make "what is this asking me to accept?"
 * a needle-hunt, so only the changed hunks and their surrounding context show.
 */
export function DiffView({
  base,
  next,
  baseLabel = 'published',
  nextLabel = 'proposed',
}: {
  base: string;
  next: string;
  baseLabel?: string;
  nextLabel?: string;
}) {
  const [context, setContext] = useState(3);

  const patch = useMemo(
    () => structuredPatch(baseLabel, nextLabel, base, next, '', '', { context }),
    [base, next, baseLabel, nextLabel, context],
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) added += 1;
        else if (line.startsWith('-')) removed += 1;
      }
    }
    return { added, removed };
  }, [patch]);

  if (!patch.hunks.length) {
    return (
      <p className="empty">
        No difference from the {baseLabel} contract — this edit request changes nothing.
      </p>
    );
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 8 }}>
        <div className="inline">
          <span className="pill pill-open">+{stats.added}</span>
          <span className="pill pill-rejected">−{stats.removed}</span>
          <span className="faint small">
            {patch.hunks.length} change{patch.hunks.length === 1 ? '' : 's'}
          </span>
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setContext(context === 3 ? 12 : 3)}>
          {context === 3 ? 'More context' : 'Less context'}
        </button>
      </div>

      <div className="diff">
        {patch.hunks.map((hunk, hunkIndex) => {
          let oldLine = hunk.oldStart;
          let newLine = hunk.newStart;

          return (
            <div key={hunkIndex}>
              <div className="diff-line diff-hunk">
                <span className="diff-num" />
                <span className="diff-text">
                  @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                </span>
              </div>
              {hunk.lines.map((line, lineIndex) => {
                const kind = line[0];
                const text = line.slice(1);
                // The counters advance differently per kind, so the gutter
                // shows the line number in the file the line belongs to.
                let gutter: number | '' = '';
                if (kind === '-') gutter = oldLine++;
                else if (kind === '+') gutter = newLine++;
                else {
                  gutter = newLine++;
                  oldLine += 1;
                }

                return (
                  <div
                    key={lineIndex}
                    className={`diff-line${kind === '+' ? ' diff-add' : kind === '-' ? ' diff-del' : ''}`}
                  >
                    <span className="diff-num">{gutter}</span>
                    <span className="diff-text">
                      {kind === ' ' ? '  ' : `${kind} `}
                      {text || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
