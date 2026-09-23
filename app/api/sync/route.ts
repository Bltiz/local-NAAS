import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { requireAdmin } from '@/lib/viewer';
import { nasMode } from '@/lib/storage';
import { connect, disconnect, getSync, triggerSync, updateSync } from '@/lib/sync';

export const dynamic = 'force-dynamic';

const localOnly = () => NextResponse.json({ error: 'Backup runs on a local NAS only' }, { status: 404 });

export const GET = protectedRoute(async (_request, viewer) => {
  requireAdmin(viewer);
  if (nasMode() !== 'local') return localOnly();
  return NextResponse.json(await getSync());
});

export const POST = protectedRoute(async (request, viewer) => {
  requireAdmin(viewer);
  if (nasMode() !== 'local') return localOnly();
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'connect':
        return NextResponse.json(await connect(String(body.serverUrl ?? ''), String(body.password ?? ''), String(body.folder ?? '')));
      case 'update':
        return NextResponse.json(await updateSync(body));
      case 'run':
        triggerSync(0);
        return NextResponse.json(await getSync());
      case 'disconnect':
        return NextResponse.json(await disconnect());
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Something went wrong' }, { status: 400 });
  }
});
