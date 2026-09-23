import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { type Share, createShare, listShares, revokeShare } from '@/lib/shares';
import { type Viewer, scope } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const view = (share: Share, viewer: Viewer) => ({
  id: share.id,
  path: scope(viewer).toUser(share.path) ?? share.path,
  type: share.type,
  createdByName: share.createdByName,
  createdAt: share.createdAt,
  expiresAt: share.expiresAt,
  hasPassword: share.passwordHash !== null,
  downloads: share.downloads,
});

export const GET = protectedRoute(async (request, viewer) => {
  const path = request.nextUrl.searchParams.get('path');
  let shares = await listShares(viewer);
  if (path) {
    const real = scope(viewer).toReal(path);
    shares = shares.filter((s) => s.path === real);
  }
  return NextResponse.json({ shares: shares.map((s) => view(s, viewer)) });
});

export const POST = protectedRoute(async (request, viewer) => {
  const body = await request.json().catch(() => ({}));
  const days = body.expiresInDays === null || body.expiresInDays === undefined ? null : Number(body.expiresInDays);
  const share = await createShare({
    realPath: scope(viewer).toReal(body.path),
    viewer,
    expiresInDays: days !== null && Number.isFinite(days) ? days : null,
    password: typeof body.password === 'string' && body.password ? body.password : null,
  });
  return NextResponse.json({ share: view(share, viewer) });
});

export const DELETE = protectedRoute(async (request, viewer) => {
  await revokeShare(request.nextUrl.searchParams.get('id') ?? '', viewer);
  return NextResponse.json({ success: true });
});
