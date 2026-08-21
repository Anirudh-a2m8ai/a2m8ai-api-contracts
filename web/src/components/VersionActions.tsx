'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Restores an earlier version.
 *
 * Implemented as a normal publish of the old YAML rather than by deleting rows,
 * so a revert is itself a version. The history stays append-only and the fact
 * that a revert happened remains visible.
 */
export function VersionActions({ versionId, isCurrent }: { versionId: number; isCurrent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function restore() {
    if (!confirm(`Republish version ${versionId} as the current contract?`)) return;

    setBusy(true);
    try {
      const yamlResponse = await fetch(`/api/spec/versions?id=${versionId}`);
      if (!yamlResponse.ok) {
        alert('Could not read that version.');
        return;
      }
      const yaml = await yamlResponse.text();

      const response = await fetch('/api/spec', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yaml, message: `Reverted to version ${versionId}` }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error ?? 'Could not restore that version.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline">
      <a className="btn btn-ghost btn-sm" href={`/api/spec/versions?id=${versionId}`}>
        View YAML
      </a>
      {!isCurrent ? (
        <button className="btn btn-sm" type="button" onClick={restore} disabled={busy}>
          {busy ? 'Restoring…' : 'Restore'}
        </button>
      ) : null}
    </div>
  );
}
