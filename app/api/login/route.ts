import { NextRequest, NextResponse } from 'next/server';
import { checkPassword, getAuthMode, sessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; firstAt: number }>();

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

export async function POST(request: NextRequest) {
  const mode = getAuthMode();
  if (mode === 'misconfigured') {
    return NextResponse.json(
      { error: 'No password is configured on the server. Set NAS_PASSWORD and redeploy.' },
      { status: 503 },
    );
  }
  if (mode === 'open') {
    return NextResponse.json({ success: true });
  }

  const ip = clientIp(request);
  const record = failures.get(ip);
  if (record && Date.now() - record.firstAt > LOCKOUT_MS) failures.delete(ip);
  const current = failures.get(ip);
  if (current && current.count >= MAX_FAILURES) {
    const minutes = Math.ceil((LOCKOUT_MS - (Date.now() - current.firstAt)) / 60000);
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
      { status: 429 },
    );
  }

  const { password } = await request.json().catch(() => ({ password: '' }));
  if (typeof password !== 'string' || !(await checkPassword(password))) {
    failures.set(ip, { count: (current?.count ?? 0) + 1, firstAt: current?.firstAt ?? Date.now() });
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  failures.delete(ip);
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
