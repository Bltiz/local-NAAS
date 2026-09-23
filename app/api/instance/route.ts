import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { listAnnounced, selfInfo } from '@/lib/instance';
import { nasMode } from '@/lib/storage';
import { getSync } from '@/lib/sync';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => {
  const self = selfInfo();
  if (nasMode() === 'local') {
    const { config } = await getSync();
    return NextResponse.json({ self, known: [], serverUrl: config.serverUrl });
  }
  return NextResponse.json({ self, known: await listAnnounced(), serverUrl: null });
});
