import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * POST only. A GET here would let any page sign the reader out with an
 * `<img src>`, which is a small thing to get wrong and an annoying one to
 * debug.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const response = NextResponse.redirect(origin, { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
