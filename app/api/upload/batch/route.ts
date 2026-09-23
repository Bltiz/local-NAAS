import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { writeBatch } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const PUT = protectedRoute(async (request) => {
  return NextResponse.json({ results: await writeBatch(request.body) });
});
