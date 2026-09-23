import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { isValidPeerId, join, leave } from '@/lib/signal';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async (request) => {
  const params = request.nextUrl.searchParams;
  const id = params.get('id');
  const name = (params.get('name') ?? '').trim().slice(0, 60) || 'Unnamed device';
  if (!isValidPeerId(id)) return NextResponse.json({ error: 'Invalid device id' }, { status: 400 });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;
  let closed = false;
  let connection: Parameters<typeof join>[0];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        leave(id, connection);
        try {
          controller.close();
        } catch {}
      };
      connection = {
        id,
        name,
        send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        close: cleanup,
      };
      write('retry: 3000\n\n');
      join(connection);
      heartbeat = setInterval(() => write(': ping\n\n'), 15000);
      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      connection?.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops Next.js and proxies from compressing/buffering the event stream.
      'Content-Encoding': 'none',
      'X-Accel-Buffering': 'no',
    },
  });
});
