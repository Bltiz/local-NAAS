import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/api';
import { cancelUpload, receivedBytes, StorageError, writeChunk } from '@/lib/storage';

export const dynamic = 'force-dynamic';

function intParam(value: string | null, name: string): number {
  const n = Number(value);
  if (value === null || !Number.isSafeInteger(n) || n < 0) throw new StorageError(`Invalid ${name}`, 400);
  return n;
}

export const GET = protectedRoute(async (request) => {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  return NextResponse.json({ received: await receivedBytes(id) });
});

export const PUT = protectedRoute(async (request) => {
  const params = request.nextUrl.searchParams;
  const result = await writeChunk({
    uploadId: params.get('id') ?? '',
    relPath: params.get('path') ?? '',
    offset: intParam(params.get('offset'), 'offset'),
    totalSize: intParam(params.get('total'), 'total'),
    mtime: params.get('mtime') ? intParam(params.get('mtime'), 'mtime') : null,
    sha256: request.headers.get('x-chunk-sha256'),
    body: request.body,
  });
  return NextResponse.json(result);
});

export const DELETE = protectedRoute(async (request) => {
  await cancelUpload(request.nextUrl.searchParams.get('id') ?? '');
  return NextResponse.json({ success: true });
});
