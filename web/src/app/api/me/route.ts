import { getViewer } from '@/lib/auth';
import { isDbConfigured } from '@/lib/db';
import { oauthConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';

/** Who the caller is, plus what this deployment is actually able to do. */
export async function GET() {
  const viewer = await getViewer();
  return Response.json({
    viewer,
    setup: {
      oauth: oauthConfigured(),
      database: isDbConfigured(),
      ownerConfigured: Boolean(process.env.OWNER_GITHUB_LOGIN?.trim()),
    },
  });
}
