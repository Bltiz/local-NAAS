import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { matchFiles } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const POST = protectedRoute(async (request) => {
  const { items } = await request.json().catch(() => ({ items: [] }));
  return NextResponse.json({ matched: await matchFiles(Array.isArray(items) ? items : []) });
});
