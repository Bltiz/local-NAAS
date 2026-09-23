import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { deleteFromTrash, listTrash, restoreFromTrash, TRASH_DAYS } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => {
  return NextResponse.json({ items: await listTrash(), keepDays: TRASH_DAYS });
});

export const POST = protectedRoute(async (request) => {
  const { id } = await request.json().catch(() => ({ id: '' }));
  return NextResponse.json({ restoredTo: await restoreFromTrash(String(id)) });
});

export const DELETE = protectedRoute(async (request) => {
  const params = request.nextUrl.searchParams;
  await deleteFromTrash(params.get('all') === '1' ? 'all' : (params.get('id') ?? ''));
  return NextResponse.json({ success: true });
});
