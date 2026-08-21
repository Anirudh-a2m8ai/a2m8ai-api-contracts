import { guard } from '@/lib/auth';
import { getVersionYaml, listVersions } from '@/lib/spec';

export const dynamic = 'force-dynamic';

/**
 * GET /api/spec/versions        history, newest first (no YAML — too large)
 * GET /api/spec/versions?id=12  the YAML of one version, for diffing or revert
 *
 * Readable by anyone: the contract is published, so its history is too.
 */
export async function GET(request: Request) {
  return guard(async () => {
    const id = new URL(request.url).searchParams.get('id');

    if (id) {
      const numeric = Number(id);
      if (!Number.isInteger(numeric) || numeric < 1) {
        return Response.json({ error: 'Invalid version id.' }, { status: 400 });
      }
      const yaml = await getVersionYaml(numeric);
      if (yaml === null) return Response.json({ error: 'No such version.' }, { status: 404 });
      return new Response(yaml, {
        headers: {
          'content-type': 'application/yaml; charset=utf-8',
          // A given version id is immutable, so this one is safe to cache hard.
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }

    return Response.json({ versions: await listVersions() }, { headers: { 'cache-control': 'no-store' } });
  });
}
