import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { writeBatch } from '@/lib/storage';
import { scope } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const PUT = protectedRoute(async (request, viewer) => {
  const s = scope(viewer);
  const results = await writeBatch(request.body, s.toReal);
  return NextResponse.json({
    results: results.map((r) => ({ ...r, path: s.toUser(r.path) ?? r.path, savedAs: r.savedAs ? (s.toUser(r.savedAs) ?? undefined) : undefined })),
  });
});
