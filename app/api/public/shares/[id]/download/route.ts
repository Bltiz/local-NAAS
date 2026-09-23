import { NextRequest, NextResponse } from 'next/server';
import { serveFile } from '@/lib/serve';
import { canAccess, countDownload, getShare, shareCookie, sharedTarget } from '@/lib/shares';
import { StorageError } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const share = await getShare(id);
    if (!canAccess(share, request.cookies.get(shareCookie(id))?.value)) {
      return NextResponse.json({ error: 'This link needs a password' }, { status: 401 });
    }
    const search = request.nextUrl.searchParams;
    const target = sharedTarget(share, search.get('path'));
    const range = request.headers.get('range');
    if (!range || /^bytes=0-/.test(range)) await countDownload(share);
    return await serveFile(request, target, search.get('inline') === '1');
  } catch (error) {
    if (error instanceof StorageError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
