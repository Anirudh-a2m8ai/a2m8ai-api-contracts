import { listSpecs } from '@/lib/specs-registry';

export const dynamic = 'force-dynamic';

/** GET /api/specs — every spec this app hosts, for the landing page. No DB call. */
export async function GET() {
  return Response.json({ specs: listSpecs() }, { headers: { 'cache-control': 'no-store' } });
}
