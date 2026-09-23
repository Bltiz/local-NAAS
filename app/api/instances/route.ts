import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { requireAdmin } from '@/lib/viewer';
import { announce, forget } from '@/lib/instance';

export const dynamic = 'force-dynamic';

export const POST = protectedRoute(async (request, viewer) => {
  requireAdmin(viewer);
  try {
    await announce(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
});

export const DELETE = protectedRoute(async (request, viewer) => {
  requireAdmin(viewer);
  await forget(request.nextUrl.searchParams.get('id') ?? '');
  return NextResponse.json({ success: true });
});
