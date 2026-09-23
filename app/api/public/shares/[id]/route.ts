import { NextRequest, NextResponse } from 'next/server';
import { canAccess, getShare, shareCookie, sharedFiles, unlockShare } from '@/lib/shares';
import { StorageError } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const attempts = new Map<string, { count: number; firstAt: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function errorResponse(error: unknown) {
  if (error instanceof StorageError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(error);
  return NextResponse.json({ error: 'Server error' }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const share = await getShare(id);
    const name = share.path.slice(share.path.lastIndexOf('/') + 1);
    const unlocked = canAccess(share, request.cookies.get(shareCookie(id))?.value);
    return NextResponse.json({
      name,
      type: share.type,
      expiresAt: share.expiresAt,
      needsPassword: !unlocked,
      sharedBy: share.createdByName === 'admin' ? null : share.createdByName,
      files: unlocked ? await sharedFiles(share) : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const share = await getShare(id);
    const key = `${request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'}:${id}`;
    const record = attempts.get(key);
    if (record && Date.now() - record.firstAt > LOCKOUT_MS) attempts.delete(key);
    const current = attempts.get(key);
    if (current && current.count >= MAX_ATTEMPTS) {
      return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
    }
    const { password } = await request.json().catch(() => ({ password: '' }));
    const token = await unlockShare(share, String(password ?? ''));
    if (!token) {
      attempts.set(key, { count: (current?.count ?? 0) + 1, firstAt: current?.firstAt ?? Date.now() });
      return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
    }
    attempts.delete(key);
    const response = NextResponse.json({ success: true });
    response.cookies.set(shareCookie(id), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
