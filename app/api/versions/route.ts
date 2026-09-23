import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { serveFile } from '@/lib/serve';
import { StorageError, getTrashItem, listVersions, restoreVersion, trashDataPath } from '@/lib/storage';
import { scope } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async (request, viewer) => {
  const s = scope(viewer);
  const params = request.nextUrl.searchParams;
  const id = params.get('download');
  if (id) {
    const item = await getTrashItem(id);
    if (!s.contains(item.path) || item.type !== 'file') throw new StorageError('Not found', 404);
    const name = item.path.slice(item.path.lastIndexOf('/') + 1);
    return serveFile(request, { abs: trashDataPath(id) }, false, name);
  }
  const versions = (await listVersions(s.toReal(params.get('path')))).map((v) => ({ ...v, path: s.toUser(v.path) }));
  return NextResponse.json({ versions });
});

export const POST = protectedRoute(async (request, viewer) => {
  const s = scope(viewer);
  const { id } = await request.json().catch(() => ({ id: '' }));
  const item = await getTrashItem(String(id));
  if (!s.contains(item.path)) throw new StorageError('Not found', 404);
  return NextResponse.json({ restored: s.toUser(await restoreVersion(item.id)) });
});
