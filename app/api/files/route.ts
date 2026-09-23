import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { cleanStaleParts, diskUsage, listEntries, makeFolder, removePath, storageInfo, trashBytes } from '@/lib/storage';
import { scope } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async (request, viewer) => {
  const s = scope(viewer);
  if (s.home) await makeFolder(s.home);
  const force = request.nextUrl.searchParams.get('refresh') === '1';
  const [all, usage, trash] = await Promise.all([listEntries(force), diskUsage(), trashBytes(s.contains)]);
  const entries = s.home
    ? all.flatMap((e) => {
        const path = s.toUser(e.path);
        return path ? [{ ...e, path }] : [];
      })
    : all;
  void cleanStaleParts();
  return NextResponse.json({ entries, usage, trashBytes: trash, storage: storageInfo() });
});

export const POST = protectedRoute(async (request, viewer) => {
  const s = scope(viewer);
  const { path } = await request.json().catch(() => ({ path: null }));
  return NextResponse.json({ path: s.toUser(await makeFolder(s.toReal(path))) });
});

export const DELETE = protectedRoute(async (request, viewer) => {
  const s = scope(viewer);
  const trashId = await removePath(s.toReal(request.nextUrl.searchParams.get('path')));
  return NextResponse.json({ success: true, trashId });
});
