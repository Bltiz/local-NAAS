import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthorized } from '@/lib/auth';

const PUBLIC_PATHS = ['/login', '/api/login', '/api/auth-status'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  if (await isAuthorized(request)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Browsers fetch the manifest and icons without cookies, so they must stay public.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|icon.png|apple-icon.png).*)'],
};
