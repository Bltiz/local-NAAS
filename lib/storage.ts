import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, open, readdir, rename, rm, stat, statfs, truncate, unlink } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';

export const ENCRYPTED_SUFFIX = '.nasenc';
const SYSTEM_DIR = '.nas-system';
const MAX_CHUNK_BYTES = 64 * 1024 * 1024 + 1024;
const STALE_PART_MS = 7 * 24 * 60 * 60 * 1000;

export interface Entry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  modified: string;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function rootDir(): string {
  return resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'));
}

function partsDir(): string {
  return join(rootDir(), SYSTEM_DIR, 'parts');
}

// Client paths are always "/"-separated and relative to the storage root.
export function normalizeRelPath(input: string | null | undefined): string {
  if (typeof input !== 'string') throw new StorageError('Path is required', 400);
  const segments = input.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) throw new StorageError('Path is required', 400);
  if (input.length > 4096) throw new StorageError('Path is too long', 400);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0')) {
      throw new StorageError('Invalid path', 400);
    }
  }
  if (segments[0] === SYSTEM_DIR) throw new StorageError('Invalid path', 400);
  return segments.join('/');
}

export function absolutePath(relPath: string): string {
  const root = rootDir();
  const abs = resolve(root, ...normalizeRelPath(relPath).split('/'));
  if (!abs.startsWith(root + sep)) throw new StorageError('Invalid path', 400);
  return abs;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}

export async function listTree(): Promise<Entry[]> {
  const root = rootDir();
  const entries: Entry[] = [];

  async function walk(dirAbs: string, dirRel: string) {
    let items;
    try {
      items = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      items.map(async (item) => {
        if (!dirRel && item.name === SYSTEM_DIR) return;
        const rel = dirRel ? `${dirRel}/${item.name}` : item.name;
        const abs = join(dirAbs, item.name);
        if (item.isDirectory()) {
          const s = await stat(abs).catch(() => null);
          entries.push({ path: rel, type: 'dir', size: 0, modified: (s?.mtime ?? new Date()).toISOString() });
          await walk(abs, rel);
        } else if (item.isFile()) {
          const s = await stat(abs).catch(() => null);
          if (s) entries.push({ path: rel, type: 'file', size: s.size, modified: s.mtime.toISOString() });
        }
      }),
    );
  }

  await walk(root, '');
  return entries;
}

export async function diskUsage(): Promise<{ free: number; total: number } | null> {
  try {
    await mkdir(rootDir(), { recursive: true });
    const s = await statfs(rootDir());
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

function partPath(uploadId: string): string {
  if (!/^[a-f0-9]{16,64}$/.test(uploadId)) throw new StorageError('Invalid upload id', 400);
  return join(partsDir(), `${uploadId}.part`);
}

export async function receivedBytes(uploadId: string): Promise<number> {
  const s = await stat(partPath(uploadId)).catch(() => null);
  return s?.size ?? 0;
}

async function uniquePath(relPath: string): Promise<string> {
  if (!(await exists(absolutePath(relPath)))) return relPath;
  const slash = relPath.lastIndexOf('/');
  const dir = slash >= 0 ? relPath.slice(0, slash + 1) : '';
  const name = relPath.slice(slash + 1);
  const encrypted = name.endsWith(ENCRYPTED_SUFFIX);
  const base = encrypted ? name.slice(0, -ENCRYPTED_SUFFIX.length) : name;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${dir}${stem} (${i})${ext}${encrypted ? ENCRYPTED_SUFFIX : ''}`;
    if (!(await exists(absolutePath(candidate)))) return candidate;
  }
}

interface ChunkInput {
  uploadId: string;
  relPath: string;
  offset: number;
  totalSize: number;
  sha256: string | null;
  body: ReadableStream<Uint8Array> | null;
}

// Appends one chunk to the upload's part file. Chunks must arrive in order;
// a mismatched offset returns 409 with the byte count the server already has.
export async function writeChunk(input: ChunkInput): Promise<{ received: number; done: boolean; path?: string }> {
  const { uploadId, offset, totalSize, sha256, body } = input;
  const relPath = normalizeRelPath(input.relPath);
  const part = partPath(uploadId);
  await mkdir(partsDir(), { recursive: true });

  const current = await receivedBytes(uploadId);
  if (current !== offset) {
    throw new StorageError('Offset mismatch', 409, { received: current });
  }

  const hash = createHash('sha256');
  const fh = await open(part, offset === 0 ? 'w' : 'a');
  let written = 0;
  try {
    if (body) {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.byteLength;
        if (written > MAX_CHUNK_BYTES || offset + written > totalSize) {
          await reader.cancel();
          throw new StorageError('Chunk too large', 413);
        }
        hash.update(value);
        await fh.write(value);
      }
    }
  } catch (error) {
    await fh.close();
    await truncate(part, offset).catch(() => {});
    throw error;
  }
  await fh.close();

  if (sha256 && hash.digest('hex') !== sha256.toLowerCase()) {
    await truncate(part, offset);
    throw new StorageError('Checksum mismatch', 422, { received: offset });
  }

  const received = offset + written;
  if (received < totalSize) return { received, done: false };

  const finalRel = await uniquePath(relPath);
  const finalAbs = absolutePath(finalRel);
  await mkdir(dirname(finalAbs), { recursive: true });
  await rename(part, finalAbs);
  return { received, done: true, path: finalRel };
}

export async function cancelUpload(uploadId: string): Promise<void> {
  await unlink(partPath(uploadId)).catch(() => {});
}

export async function cleanStaleParts(): Promise<void> {
  const dir = partsDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const now = Date.now();
  await Promise.all(
    names.map(async (name) => {
      const s = await stat(join(dir, name)).catch(() => null);
      if (s && now - s.mtimeMs > STALE_PART_MS) await unlink(join(dir, name)).catch(() => {});
    }),
  );
}

export async function makeFolder(relPath: string): Promise<string> {
  const finalRel = await uniquePath(normalizeRelPath(relPath));
  await mkdir(absolutePath(finalRel), { recursive: true });
  return finalRel;
}

export async function removePath(relPath: string): Promise<void> {
  const abs = absolutePath(relPath);
  if (!(await exists(abs))) throw new StorageError('Not found', 404);
  await rm(abs, { recursive: true, force: true });
}

export async function openForRead(relPath: string, range?: { start: number; end: number }) {
  const abs = absolutePath(relPath);
  const s = await stat(abs).catch(() => null);
  if (!s || !s.isFile()) throw new StorageError('Not found', 404);
  return {
    size: s.size,
    modified: s.mtime,
    stream: createReadStream(abs, range ? { start: range.start, end: range.end, highWaterMark: 1024 * 1024 } : { highWaterMark: 1024 * 1024 }),
  };
}

export async function fileSize(relPath: string): Promise<number> {
  const s = await stat(absolutePath(relPath)).catch(() => null);
  if (!s || !s.isFile()) throw new StorageError('Not found', 404);
  return s.size;
}
