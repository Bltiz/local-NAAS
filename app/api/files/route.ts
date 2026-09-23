import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { cleanStaleParts, diskUsage, listTree, makeFolder, removePath } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => {
  const [entries, usage] = await Promise.all([listTree(), diskUsage()]);
  void cleanStaleParts();
  return NextResponse.json({ entries, usage });
});

export const POST = protectedRoute(async (request) => {
  const { path } = await request.json().catch(() => ({ path: null }));
  const created = await makeFolder(path);
  return NextResponse.json({ path: created });
});

export const DELETE = protectedRoute(async (request) => {
  await removePath(request.nextUrl.searchParams.get('path') ?? '');
  return NextResponse.json({ success: true });
});
