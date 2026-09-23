import { Readable } from 'stream';
import { protectedRoute } from '@/lib/api';
import { mimeTypeOf } from '@/lib/file-types';
import { fileSize, normalizeRelPath, openForRead } from '@/lib/storage';

export const dynamic = 'force-dynamic';

function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const [, startStr, endStr] = match;
  let start: number;
  let end: number;
  if (startStr === '') {
    const suffix = Number(endStr);
    if (!suffix) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

function contentDisposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const GET = protectedRoute(async (request) => {
  const params = request.nextUrl.searchParams;
  const relPath = normalizeRelPath(params.get('path'));
  const inline = params.get('inline') === '1';
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);

  const size = await fileSize(relPath);
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const { stream } = await openForRead(relPath, range ?? undefined);
  const headers = new Headers({
    'Content-Type': inline ? mimeTypeOf(name) : 'application/octet-stream',
    'Content-Disposition': contentDisposition(name, inline),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    // Uploaded HTML/SVG must never run scripts on this origin.
    'Content-Security-Policy': 'sandbox',
    'X-Content-Type-Options': 'nosniff',
  });

  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
  } else {
    headers.set('Content-Length', String(size));
  }

  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
});
