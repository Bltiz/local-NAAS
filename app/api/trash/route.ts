import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { StorageError, TRASH_DAYS, deleteFromTrash, getTrashItem, listTrash, restoreFromTrash } from '@/lib/storage';
import { type Viewer, scope } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

async function ownedItem(viewer: Viewer, id: string) {
  const item = await getTrashItem(id);
  if (!scope(viewer).contains(item.path)) throw new StorageError('Not found in trash', 404);
  return item;
}

export const GET = protectedRoute(async (_request, viewer) => {
  const s = scope(viewer);
  const items = (await listTrash()).flatMap((i) => {
    const path = s.toUser(i.path);
    return path ? [{ ...i, path }] : [];
  });
  return NextResponse.json({ items, keepDays: TRASH_DAYS });
});

export const POST = protectedRoute(async (request, viewer) => {
  const { id } = await request.json().catch(() => ({ id: '' }));
  await ownedItem(viewer, String(id));
  return NextResponse.json({ restoredTo: scope(viewer).toUser(await restoreFromTrash(String(id))) });
});

export const DELETE = protectedRoute(async (request, viewer) => {
  const params = request.nextUrl.searchParams;
  const s = scope(viewer);
  if (params.get('all') === '1') {
    if (!s.home) await deleteFromTrash('all');
    else await deleteFromTrash((await listTrash()).filter((i) => s.contains(i.path)).map((i) => i.id));
  } else {
    const id = params.get('id') ?? '';
    await ownedItem(viewer, id);
    await deleteFromTrash([id]);
  }
  return NextResponse.json({ success: true });
});
