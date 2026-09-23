import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { cleanStaleParts, diskUsage, listEntries, makeFolder, removePath, storageInfo, trashBytes } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async (request) => {
  const force = request.nextUrl.searchParams.get('refresh') === '1';
  const [entries, usage, trash] = await Promise.all([listEntries(force), diskUsage(), trashBytes()]);
  void cleanStaleParts();
  return NextResponse.json({ entries, usage, trashBytes: trash, storage: storageInfo() });
});

export const POST = protectedRoute(async (request) => {
  const { path } = await request.json().catch(() => ({ path: null }));
  return NextResponse.json({ path: await makeFolder(path) });
});

export const DELETE = protectedRoute(async (request) => {
  const trashId = await removePath(request.nextUrl.searchParams.get('path') ?? '');
  return NextResponse.json({ success: true, trashId });
});
