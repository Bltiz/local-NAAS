import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { isValidPeerId, relay } from '@/lib/signal';

export const dynamic = 'force-dynamic';

export const POST = protectedRoute(async (request) => {
  const text = await request.text();
  if (text.length > 256 * 1024) return NextResponse.json({ error: 'Message too large' }, { status: 413 });
  const { from, to, payload } = JSON.parse(text || '{}');
  if (!isValidPeerId(from) || !isValidPeerId(to)) {
    return NextResponse.json({ error: 'Invalid device id' }, { status: 400 });
  }
  if (!relay(from, to, payload)) {
    return NextResponse.json({ error: 'That device is no longer online' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
