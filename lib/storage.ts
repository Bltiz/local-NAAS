import { createHash, randomBytes } from 'crypto';
import { createReadStream, watch, type FSWatcher } from 'fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs, truncate, unlink, utimes, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';

export const ENCRYPTED_SUFFIX = '.nasenc';
export const SYSTEM_DIR = '.nas-system';
const MAX_CHUNK_BYTES = 64 * 1024 * 1024 + 1024;
const STALE_PART_MS = 7 * 24 * 60 * 60 * 1000;
export const TRASH_DAYS = 30;

export interface Entry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  modified: string;
}

export interface TrashItem {
  id: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  deletedAt: string;
  reason: 'deleted' | 'replaced';
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

export type NasMode = 'server' | 'local';

export function nasMode(): NasMode {
  return process.env.NAS_MODE === 'local' ? 'local' : 'server';
}

export function rootDir(): string {
  return resolve(process.env.UPLOAD_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || join(process.cwd(), 'uploads'));
}

const systemDir = () => join(rootDir(), SYSTEM_DIR);
const partsDir = () => join(systemDir(), 'parts');
const trashDir = () => join(systemDir(), 'trash');

// Client paths are always "/"-separated and relative to the storage root.
export function normalizeRelPath(input: string | null | undefined): string {
  if (typeof input !== 'string') throw new StorageError('Path is required', 400);
  if (input.length > 4096) throw new StorageError('Path is too long', 400);
  const segments = input.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) throw new StorageError('Path is required', 400);
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

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

// ---------------------------------------------------------------------------
// In-memory index. Our own writes update it directly; in local mode a file
// watcher marks it dirty so edits made outside the app show up too.

interface IndexState {
  entries: Map<string, Entry> | null;
  building: Promise<Map<string, Entry>> | null;
  dirty: boolean;
  watcher: FSWatcher | null;
}

const g = globalThis as unknown as { __nasIndex?: IndexState };
const index: IndexState = (g.__nasIndex ??= { entries: null, building: null, dirty: true, watcher: null });

async function walkTree(): Promise<Map<string, Entry>> {
  const root = rootDir();
  const map = new Map<string, Entry>();
  async function walk(dirAbs: string, dirRel: string) {
    const items = await readdir(dirAbs, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      items.map(async (item) => {
        if (!dirRel && item.name === SYSTEM_DIR) return;
        const rel = dirRel ? `${dirRel}/${item.name}` : item.name;
        const abs = join(dirAbs, item.name);
        if (item.isDirectory()) {
          const s = await stat(abs).catch(() => null);
          map.set(rel, { path: rel, type: 'dir', size: 0, modified: (s?.mtime ?? new Date()).toISOString() });
          await walk(abs, rel);
        } else if (item.isFile()) {
          const s = await stat(abs).catch(() => null);
          if (s) map.set(rel, { path: rel, type: 'file', size: s.size, modified: s.mtime.toISOString() });
        }
      }),
    );
  }
  await walk(root, '');
  return map;
}

function startWatcher() {
  if (index.watcher || nasMode() !== 'local') return;
  try {
    index.watcher = watch(rootDir(), { recursive: true }, (_event, filename) => {
      const name = String(filename ?? '').replaceAll('\\', '/');
      if (name === SYSTEM_DIR || name.startsWith(`${SYSTEM_DIR}/`)) return;
      index.dirty = true;
    });
    index.watcher.on('error', () => {
      index.watcher = null;
    });
  } catch {
    index.watcher = null;
  }
}

export async function getIndex(force = false): Promise<Map<string, Entry>> {
  startWatcher();
  // Without a watcher (e.g. unsupported platform) local mode rescans on every request.
  if (nasMode() === 'local' && !index.watcher) index.dirty = true;
  if (!force && !index.dirty && index.entries) return index.entries;
  if (!index.building) {
    index.dirty = false;
    index.building = walkTree()
      .then((map) => {
        index.entries = map;
        return map;
      })
      .finally(() => {
        index.building = null;
      });
  }
  return index.building;
}

function indexPut(entry: Entry) {
  const map = index.entries;
  if (!map) return;
  map.set(entry.path, entry);
  for (let p = parentOf(entry.path); p && !map.has(p); p = parentOf(p)) {
    map.set(p, { path: p, type: 'dir', size: 0, modified: entry.modified });
  }
}

function indexRemove(rel: string) {
  const map = index.entries;
  if (!map) return;
  map.delete(rel);
  const prefix = `${rel}/`;
  for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
}

export async function listEntries(force = false): Promise<Entry[]> {
  return Array.from((await getIndex(force)).values());
}

// ---------------------------------------------------------------------------

async function statOrNull(abs: string) {
  return stat(abs).catch(() => null);
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

export function storageInfo() {
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PUBLIC_DOMAIN);
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const root = rootDir();
  const persistent = !onRailway ? null : Boolean(volume && (root === resolve(volume) || root.startsWith(resolve(volume) + sep)));
  return {
    mode: nasMode(),
    name: process.env.NAS_NAME || (nasMode() === 'local' ? 'This PC' : 'Server'),
    location: nasMode() === 'local' ? root : onRailway ? 'Railway volume' : root,
    persistent,
  };
}

async function uniquePath(relPath: string): Promise<string> {
  if (!(await statOrNull(absolutePath(relPath)))) return relPath;
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
  const name = relPath.slice(dir.length);
  const encrypted = name.endsWith(ENCRYPTED_SUFFIX);
  const base = encrypted ? name.slice(0, -ENCRYPTED_SUFFIX.length) : name;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = `${dir}${stem} (${i})${ext}${encrypted ? ENCRYPTED_SUFFIX : ''}`;
    if (!(await statOrNull(absolutePath(candidate)))) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Trash

async function folderSize(rel: string): Promise<number> {
  const map = await getIndex();
  const prefix = `${rel}/`;
  let total = 0;
  for (const e of map.values()) if (e.type === 'file' && e.path.startsWith(prefix)) total += e.size;
  return total;
}

export async function moveToTrash(relPath: string, reason: TrashItem['reason'] = 'deleted'): Promise<string> {
  const rel = normalizeRelPath(relPath);
  const abs = absolutePath(rel);
  const s = await statOrNull(abs);
  if (!s) throw new StorageError('Not found', 404);
  const id = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const dir = join(trashDir(), id);
  await mkdir(dir, { recursive: true });
  const item: TrashItem = {
    id,
    path: rel,
    type: s.isDirectory() ? 'dir' : 'file',
    size: s.isDirectory() ? await folderSize(rel) : s.size,
    deletedAt: new Date().toISOString(),
    reason,
  };
  await rename(abs, join(dir, 'data'));
  await writeFile(join(dir, 'meta.json'), JSON.stringify(item));
  indexRemove(rel);
  return id;
}

export async function listTrash(): Promise<TrashItem[]> {
  const ids = await readdir(trashDir()).catch(() => [] as string[]);
  const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const item = JSON.parse(await readFile(join(trashDir(), id, 'meta.json'), 'utf8')) as TrashItem;
        if (new Date(item.deletedAt).getTime() < cutoff) {
          await rm(join(trashDir(), id), { recursive: true, force: true });
          return null;
        }
        return item;
      } catch {
        return null;
      }
    }),
  );
  return items.filter((i): i is TrashItem => i !== null).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

function trashItemDir(id: string): string {
  if (!/^[a-z0-9]+-[a-f0-9]{8}$/.test(id)) throw new StorageError('Invalid trash id', 400);
  return join(trashDir(), id);
}

export async function restoreFromTrash(id: string): Promise<string> {
  const dir = trashItemDir(id);
  const item = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8').catch(() => {
    throw new StorageError('Not found in trash', 404);
  })) as TrashItem;
  const target = await uniquePath(item.path);
  const abs = absolutePath(target);
  await mkdir(dirname(abs), { recursive: true });
  await rename(join(dir, 'data'), abs);
  await rm(dir, { recursive: true, force: true });
  index.dirty = true;
  return target;
}

export async function deleteFromTrash(id: string | 'all'): Promise<void> {
  if (id === 'all') {
    await rm(trashDir(), { recursive: true, force: true });
    return;
  }
  await rm(trashItemDir(id), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Writes

// Moves a finished temp file into place. An existing file at the target goes to
// the trash (so the folder stays a clean mirror without losing the old version).
async function placeFile(tmpAbs: string, relPath: string, mtimeMs: number | null): Promise<string> {
  let target = normalizeRelPath(relPath);
  const existing = await statOrNull(absolutePath(target));
  if (existing?.isDirectory()) target = await uniquePath(target);
  else if (existing) await moveToTrash(target, 'replaced');
  const abs = absolutePath(target);
  await mkdir(dirname(abs), { recursive: true });
  await rename(tmpAbs, abs);
  const modified = mtimeMs && Number.isFinite(mtimeMs) ? new Date(mtimeMs) : new Date();
  if (mtimeMs) await utimes(abs, new Date(), modified).catch(() => {});
  const s = await stat(abs);
  indexPut({ path: target, type: 'file', size: s.size, modified: modified.toISOString() });
  return target;
}

function partPath(uploadId: string): string {
  if (!/^[a-f0-9]{16,64}$/.test(uploadId)) throw new StorageError('Invalid upload id', 400);
  return join(partsDir(), `${uploadId}.part`);
}

export async function receivedBytes(uploadId: string): Promise<number> {
  return (await statOrNull(partPath(uploadId)))?.size ?? 0;
}

interface ChunkInput {
  uploadId: string;
  relPath: string;
  offset: number;
  totalSize: number;
  mtime: number | null;
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
  if (current !== offset) throw new StorageError('Offset mismatch', 409, { received: current });

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
  return { received, done: true, path: await placeFile(part, relPath, input.mtime) };
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
      const s = await statOrNull(join(dir, name));
      if (s && now - s.mtimeMs > STALE_PART_MS) await unlink(join(dir, name)).catch(() => {});
    }),
  );
}

// Buffered reader over a request body, used to unpack batch uploads.
class BodyReader {
  private parts: Uint8Array[] = [];
  private buffered = 0;
  private done = false;
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async fill(min: number) {
    while (this.buffered < min && !this.done) {
      const { done, value } = await this.reader.read();
      if (done) this.done = true;
      else {
        this.parts.push(value);
        this.buffered += value.byteLength;
      }
    }
    if (this.buffered < min) throw new StorageError('Upload ended early', 400);
  }

  async readExact(n: number): Promise<Uint8Array> {
    await this.fill(n);
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const head = this.parts[0];
      const take = Math.min(head.byteLength, n - filled);
      out.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.byteLength) this.parts.shift();
      else this.parts[0] = head.subarray(take);
    }
    this.buffered -= n;
    return out;
  }

  // Streams exactly n bytes to the callback without buffering them all.
  async pipe(n: number, onData: (chunk: Uint8Array) => Promise<void>) {
    let remaining = n;
    while (remaining > 0) {
      if (this.buffered === 0) await this.fill(1);
      const head = this.parts[0];
      const take = Math.min(head.byteLength, remaining);
      await onData(head.subarray(0, take));
      if (take === head.byteLength) this.parts.shift();
      else this.parts[0] = head.subarray(take);
      this.buffered -= take;
      remaining -= take;
    }
  }
}

export interface BatchFile {
  path: string;
  size: number;
  mtime?: number;
  sha256: string;
}

export interface BatchResult {
  path: string;
  ok: boolean;
  savedAs?: string;
  size?: number;
  error?: string;
}

const MAX_BATCH_FILES = 2000;
const MAX_BATCH_BYTES = 64 * 1024 * 1024;

// Body layout: u32 manifest length | manifest JSON | each file's bytes in order.
export async function writeBatch(body: ReadableStream<Uint8Array> | null): Promise<BatchResult[]> {
  if (!body) throw new StorageError('Empty upload', 400);
  const reader = new BodyReader(body.getReader());
  const head = await reader.readExact(4);
  const manifestLen = new DataView(head.buffer, head.byteOffset).getUint32(0);
  if (manifestLen > 4 * 1024 * 1024) throw new StorageError('Manifest too large', 413);
  const manifest = JSON.parse(new TextDecoder().decode(await reader.readExact(manifestLen))) as { files: BatchFile[] };
  const files = manifest.files ?? [];
  if (files.length > MAX_BATCH_FILES) throw new StorageError('Too many files in one batch', 413);
  const total = files.reduce((a, f) => a + (Number(f.size) || 0), 0);
  if (total > MAX_BATCH_BYTES) throw new StorageError('Batch too large', 413);

  await mkdir(partsDir(), { recursive: true });
  const results: BatchResult[] = [];
  for (const file of files) {
    const size = Number(file.size);
    let valid = Number.isSafeInteger(size) && size >= 0;
    let relPath = '';
    try {
      relPath = normalizeRelPath(file.path);
    } catch {
      valid = false;
    }
    if (!valid) {
      await reader.pipe(Math.max(0, size || 0), async () => {});
      results.push({ path: file.path, ok: false, error: 'Invalid path' });
      continue;
    }

    const tmp = join(partsDir(), `batch-${randomBytes(8).toString('hex')}.part`);
    const hash = createHash('sha256');
    const fh = await open(tmp, 'w');
    try {
      await reader.pipe(size, async (chunk) => {
        hash.update(chunk);
        await fh.write(chunk);
      });
    } finally {
      await fh.close();
    }
    if (hash.digest('hex') !== String(file.sha256).toLowerCase()) {
      await unlink(tmp).catch(() => {});
      results.push({ path: relPath, ok: false, error: 'Checksum mismatch' });
      continue;
    }
    try {
      const savedAs = await placeFile(tmp, relPath, file.mtime ?? null);
      results.push({ path: relPath, ok: true, savedAs, size });
    } catch (error) {
      await unlink(tmp).catch(() => {});
      results.push({ path: relPath, ok: false, error: error instanceof Error ? error.message : 'Could not save' });
    }
  }
  return results;
}

async function hashFile(abs: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(abs, { highWaterMark: 1024 * 1024 })) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

// For files whose size matches but modified date doesn't (e.g. uploaded before
// dates were kept), compare contents; identical ones get the client's date so
// future comparisons are instant.
export async function matchFiles(items: { path: string; sha256: string; mtime?: number }[]): Promise<string[]> {
  const matched: string[] = [];
  for (const item of items.slice(0, 1000)) {
    try {
      const rel = normalizeRelPath(item.path);
      const abs = absolutePath(rel);
      const s = await statOrNull(abs);
      if (!s?.isFile() || s.size > 256 * 1024 * 1024) continue;
      if ((await hashFile(abs)) !== String(item.sha256).toLowerCase()) continue;
      if (item.mtime) {
        await utimes(abs, new Date(), new Date(item.mtime)).catch(() => {});
        indexPut({ path: rel, type: 'file', size: s.size, modified: new Date(item.mtime).toISOString() });
      }
      matched.push(rel);
    } catch {}
  }
  return matched;
}

export async function makeFolder(relPath: string): Promise<string> {
  let rel = normalizeRelPath(relPath);
  const existing = await statOrNull(absolutePath(rel));
  if (existing?.isDirectory()) return rel;
  if (existing) rel = await uniquePath(rel);
  await mkdir(absolutePath(rel), { recursive: true });
  indexPut({ path: rel, type: 'dir', size: 0, modified: new Date().toISOString() });
  return rel;
}

export async function removePath(relPath: string): Promise<string> {
  return moveToTrash(relPath, 'deleted');
}

export async function openForRead(relPath: string, range?: { start: number; end: number }) {
  const abs = absolutePath(relPath);
  const s = await statOrNull(abs);
  if (!s || !s.isFile()) throw new StorageError('Not found', 404);
  return {
    size: s.size,
    modified: s.mtime,
    stream: createReadStream(abs, range ? { start: range.start, end: range.end, highWaterMark: 1024 * 1024 } : { highWaterMark: 1024 * 1024 }),
  };
}

export async function fileSize(relPath: string): Promise<number> {
  const s = await statOrNull(absolutePath(relPath));
  if (!s || !s.isFile()) throw new StorageError('Not found', 404);
  return s.size;
}

export async function trashBytes(): Promise<number> {
  return (await listTrash()).reduce((a, i) => a + i.size, 0);
}
