import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { matchFiles } from '@/lib/storage';
import { scope } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const POST = protectedRoute(async (request, viewer) => {
  const s = scope(viewer);
  const { items } = await request.json().catch(() => ({ items: [] }));
  const mapped = (Array.isArray(items) ? items : []).flatMap((i: { path: string; sha256: string; mtime?: number }) => {
    try {
      return [{ ...i, path: s.toReal(i.path) }];
    } catch {
      return [];
    }
  });
  const matched = (await matchFiles(mapped)).map((p) => s.toUser(p)).filter(Boolean);
  return NextResponse.json({ matched });
});
