import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthorized } from '@/lib/auth';

// Only pages are gated here. API routes check the session themselves, and must
// bypass the proxy because it buffers request bodies (capped at 10MB), which
// would truncate upload chunks.
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/login') return NextResponse.next();
  if (await isAuthorized(request)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Browsers fetch the manifest and icons without cookies, so they must stay public.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|icon.png|apple-icon.png).*)'],
};
