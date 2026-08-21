import { parse as parseYaml } from 'yaml';
import { guard, requireOwner } from '@/lib/auth';
import { getCurrentSpec, saveSpecVersion } from '@/lib/spec';
import { validateSpec } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/spec            the published contract as YAML
 * GET  /api/spec?format=json  the same contract as JSON, for codegen
 * PUT  /api/spec            publish a new version — OWNER ONLY
 */
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get('format');
  const current = await getCurrentSpec();

  const headers: Record<string, string> = {
    // The contract changes the moment the owner saves; a cached copy would
    // hand consumers a version that no longer exists.
    'cache-control': 'no-store',
    'x-spec-version': current.version ? String(current.version.id) : 'seed',
  };

  if (format === 'json') {
    return Response.json(parseYaml(current.yaml), { headers });
  }

  return new Response(current.yaml, {
    headers: {
      ...headers,
      'content-type': 'application/yaml; charset=utf-8',
      'content-disposition': 'inline; filename="ai-service.openapi.yaml"',
    },
  });
}

export async function PUT(request: Request) {
  return guard(async () => {
    // The only path in the app that rewrites the contract in place. Everyone
    // who is not the owner lands on POST /api/proposals instead.
    const owner = await requireOwner();

    const body = (await request.json()) as { yaml?: unknown; message?: unknown };
    if (typeof body.yaml !== 'string') {
      return Response.json({ error: 'Expected a `yaml` string.' }, { status: 400 });
    }

    const result = validateSpec(body.yaml);
    if (!result.ok) {
      return Response.json(
        { error: 'The contract did not validate.', errors: result.errors, warnings: result.warnings },
        { status: 422 },
      );
    }

    // No-op guard: saving without changing anything would add a version row
    // that says nothing, and clutter the history the owner reads to review.
    const current = await getCurrentSpec();
    if (current.yaml === body.yaml) {
      return Response.json(
        { unchanged: true, version: current.version, warnings: result.warnings },
        { status: 200 },
      );
    }

    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
    const version = await saveSpecVersion({
      yaml: body.yaml,
      message: message || 'Edited in the browser',
      author: owner,
    });

    return Response.json({ version, warnings: result.warnings }, { status: 201 });
  });
}
