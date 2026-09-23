// Keeps the local NAS folder in sync with a folder on a server NAS ("chain").
// Runs only in local mode. Backup-only mode never touches files on this PC.
// Two-way mode also brings server changes down. Nothing is ever erased
// outright: replaced and deleted files go to the Trash on the side they left.

import { createHash, randomBytes } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, open, readFile, unlink, writeFile } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { lanUrls } from '@/lib/instance';
import { rebuildableKind } from '@/lib/rebuildable';
import {
  type Entry,
  absolutePath,
  getIndex,
  makeFolder,
  moveToTrash,
  nasMode,
  onExternalChange,
  partsDir,
  placeFile,
  systemDir,
} from '@/lib/storage';

const INTERVAL_MS = 5 * 60 * 1000;
const CHANGE_DEBOUNCE_MS = 30 * 1000;
const HEARTBEAT_MS = 2 * 60 * 1000;
const SMALL_FILE = 4 * 1024 * 1024;
const BATCH_BYTES = 8 * 1024 * 1024;
const BATCH_FILES = 500;
const CHUNK = 8 * 1024 * 1024;
const CONCURRENCY = 4;
const MTIME_TOLERANCE = 2000;

export interface SyncConfig {
  instanceId: string;
  serverUrl: string | null;
  token: string | null;
  folder: string;
  enabled: boolean;
  skipRebuildable: boolean;
  mirrorDeletes: boolean;
  twoWay: boolean;
  lastSyncAt: string | null;
}

export type SyncState = 'not-connected' | 'paused' | 'idle' | 'scanning' | 'syncing' | 'offline' | 'signed-out' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: string | null;
  lastError: string | null;
  totalFiles: number;
  doneFiles: number;
  failedFiles: number;
  totalBytes: number;
  doneBytes: number;
  deleted: number;
  pulled: number;
  deletedLocal: number;
  conflicts: number;
  unchanged: number;
  current: string | null;
  nextRunAt: string | null;
}

class SignedOutError extends Error {}

interface SyncRuntime {
  config: SyncConfig | null;
  status: SyncStatus;
  running: boolean;
  rerun: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  started: boolean;
}

const g = globalThis as unknown as { __nasSync?: SyncRuntime };
const rt: SyncRuntime = (g.__nasSync ??= {
  config: null,
  status: {
    state: 'not-connected',
    lastSyncAt: null,
    lastError: null,
    totalFiles: 0,
    doneFiles: 0,
    failedFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
    deleted: 0,
    pulled: 0,
    deletedLocal: 0,
    conflicts: 0,
    unchanged: 0,
    current: null,
    nextRunAt: null,
  },
  running: false,
  rerun: false,
  timer: null,
  heartbeat: null,
  started: false,
});

const configFile = () => join(systemDir(), 'sync.json');

async function loadConfig(): Promise<SyncConfig> {
  if (rt.config) return rt.config;
  let saved: Partial<SyncConfig> = {};
  try {
    saved = JSON.parse(await readFile(configFile(), 'utf8'));
  } catch {}
  rt.config = {
    instanceId: saved.instanceId && /^[a-f0-9]{32}$/.test(saved.instanceId) ? saved.instanceId : randomBytes(16).toString('hex'),
    serverUrl: saved.serverUrl ?? null,
    token: saved.token ?? null,
    folder: saved.folder || process.env.NAS_NAME || 'My PC',
    enabled: saved.enabled ?? true,
    skipRebuildable: saved.skipRebuildable ?? false,
    mirrorDeletes: saved.mirrorDeletes ?? true,
    twoWay: saved.twoWay ?? true,
    lastSyncAt: saved.lastSyncAt ?? null,
  };
  rt.status.lastSyncAt = rt.config.lastSyncAt;
  await saveConfig();
  return rt.config;
}

async function saveConfig() {
  if (!rt.config) return;
  await mkdir(systemDir(), { recursive: true });
  await writeFile(configFile(), JSON.stringify(rt.config, null, 2));
}

function baseState(config: SyncConfig): SyncState {
  if (!config.serverUrl || config.token === null) return 'not-connected';
  return config.enabled ? 'idle' : 'paused';
}

export async function getSync() {
  const config = await loadConfig();
  if (!rt.running && !['offline', 'signed-out', 'error'].includes(rt.status.state)) rt.status.state = baseState(config);
  const { token, ...safe } = config;
  return { config: { ...safe, connected: Boolean(config.serverUrl && token !== null) }, status: rt.status };
}

function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an http:// or https:// address.');
  return url.origin;
}

function cleanFolder(folder: string): string {
  const cleaned = folder
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..' && s !== '.nas-system')
    .join('/');
  if (!cleaned) throw new Error('Choose a folder name on the server.');
  return cleaned;
}

export async function connect(serverUrl: string, password: string, folder: string) {
  const config = await loadConfig();
  const origin = normalizeUrl(serverUrl);
  const res = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).catch(() => {
    throw new Error('Couldn’t reach that server. Check the address and your internet connection.');
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Sign-in failed (${res.status}).`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('nas_session='));
  const token = cookie ? cookie.slice('nas_session='.length).split(';')[0] : '';
  const check = await fetch(`${origin}/api/auth-status`, { headers: { cookie: `nas_session=${token}` } });
  if (!check.ok || !(await check.json()).authenticated) throw new Error('Signed in, but the server didn’t accept the session.');

  Object.assign(config, { serverUrl: origin, token, folder: cleanFolder(folder), enabled: true });
  await saveConfig();
  rt.status.state = 'idle';
  rt.status.lastError = null;
  triggerSync(1000);
  return getSync();
}

export async function updateSync(patch: Partial<Pick<SyncConfig, 'enabled' | 'skipRebuildable' | 'mirrorDeletes' | 'twoWay' | 'folder'>>) {
  const config = await loadConfig();
  if (typeof patch.twoWay === 'boolean') config.twoWay = patch.twoWay;
  if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
  if (typeof patch.skipRebuildable === 'boolean') config.skipRebuildable = patch.skipRebuildable;
  if (typeof patch.mirrorDeletes === 'boolean') config.mirrorDeletes = patch.mirrorDeletes;
  if (typeof patch.folder === 'string') config.folder = cleanFolder(patch.folder);
  await saveConfig();
  if (config.enabled) triggerSync(1000);
  else if (!rt.running) rt.status.state = baseState(config);
  return getSync();
}

export async function disconnect() {
  const config = await loadConfig();
  config.serverUrl = null;
  config.token = null;
  await saveConfig();
  rt.status.state = 'not-connected';
  rt.status.lastError = null;
  return getSync();
}

export function triggerSync(delay = 0) {
  if (rt.timer) clearTimeout(rt.timer);
  rt.status.nextRunAt = new Date(Date.now() + delay).toISOString();
  rt.timer = setTimeout(() => {
    rt.timer = null;
    runSync().catch((e) => console.error('sync failed', e));
  }, delay);
}

export async function startSync() {
  if (rt.started || nasMode() !== 'local') return;
  rt.started = true;
  await loadConfig();
  onExternalChange(() => {
    if (rt.config?.enabled && rt.config.serverUrl && !rt.running) triggerSync(CHANGE_DEBOUNCE_MS);
  });
  rt.heartbeat = setInterval(() => announce().catch(() => {}), HEARTBEAT_MS);
  triggerSync(5000);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const config = rt.config!;
  let res: Response;
  try {
    res = await fetch(`${config.serverUrl}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), cookie: `nas_session=${config.token ?? ''}` },
    });
  } catch {
    throw Object.assign(new Error('Can’t reach the server right now.'), { offline: true });
  }
  if (res.status === 401) throw new SignedOutError('The server password changed. Reconnect to keep syncing.');
  return res;
}

async function announce() {
  const config = rt.config;
  if (!config?.serverUrl || config.token === null) return;
  await api('/api/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: config.instanceId,
      name: process.env.NAS_NAME || 'Local PC',
      urls: lanUrls(),
      folder: config.folder,
      lastSyncAt: config.lastSyncAt,
    }),
  });
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

// Paths whose transfer failed in the current run; they stay out of the saved
// sync state so the next run retries them in the right direction.
const runFailed = new Set<string>();

async function hashLocal(rel: string): Promise<string> {
  const hash = createHash('sha256');
  const fh = await open(absolutePath(rel), 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fh.close();
  }
  return hash.digest('hex');
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
    }),
  );
}

async function uploadBatch(files: Entry[], remote: (rel: string) => string) {
  const data = await Promise.all(files.map((f) => readFile(absolutePath(f.path))));
  const manifest = Buffer.from(
    JSON.stringify({
      files: files.map((f, i) => ({ path: remote(f.path), size: data[i].length, mtime: new Date(f.modified).getTime(), sha256: sha256(data[i]) })),
    }),
  );
  const head = Buffer.alloc(4);
  head.writeUInt32BE(manifest.length);
  rt.status.current = files[0]?.path ?? null;
  const res = await api('/api/upload/batch', { method: 'PUT', body: Buffer.concat([head, manifest, ...data]) });
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  const { results } = (await res.json()) as { results: { ok: boolean }[] };
  results.forEach((r, i) => {
    if (r.ok) {
      rt.status.doneFiles++;
      rt.status.doneBytes += data[i].length;
    } else {
      rt.status.failedFiles++;
      runFailed.add(files[i].path);
    }
  });
}

async function uploadLarge(file: Entry, remotePath: string) {
  const mtime = new Date(file.modified).getTime();
  const id = createHash('sha256').update(`${remotePath}|${file.size}|${mtime}`).digest('hex').slice(0, 32);
  rt.status.current = file.path;
  const status = await api(`/api/upload?id=${id}`);
  let offset = status.ok ? ((await status.json()).received ?? 0) : 0;
  if (offset > file.size) offset = 0;
  const fh = await open(absolutePath(file.path), 'r');
  try {
    for (;;) {
      const length = Math.min(CHUNK, file.size - offset);
      const buf = Buffer.alloc(length);
      const { bytesRead } = length > 0 ? await fh.read(buf, 0, length, offset) : { bytesRead: 0 };
      const chunk = buf.subarray(0, bytesRead);
      const url = `/api/upload?id=${id}&path=${encodeURIComponent(remotePath)}&offset=${offset}&total=${file.size}&mtime=${mtime}`;
      const res = await api(url, { method: 'PUT', body: chunk, headers: { 'x-chunk-sha256': sha256(chunk) } });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        offset = body.received ?? 0;
        continue;
      }
      if (!res.ok) throw new Error(body.error || `Server error (${res.status})`);
      rt.status.doneBytes += chunk.length;
      offset = body.received;
      if (body.done) break;
      if (bytesRead === 0) throw new Error('File changed while backing up');
    }
    rt.status.doneFiles++;
  } finally {
    await fh.close();
  }
}


// What both sides looked like after the last successful run, so a difference
// can be attributed to the side that changed. Files: [size, mtimeMs]; dirs: -1.
interface SavedSyncState {
  folder: string;
  entries: Record<string, [number, number] | -1>;
}

const stateFile = () => join(systemDir(), 'sync-state.json');

async function loadState(folder: string): Promise<Map<string, [number, number] | -1>> {
  try {
    const saved = JSON.parse(await readFile(stateFile(), 'utf8')) as SavedSyncState;
    if (saved.folder === folder) return new Map(Object.entries(saved.entries));
  } catch {}
  return new Map();
}

async function saveState(folder: string, entries: Map<string, [number, number] | -1>) {
  await mkdir(systemDir(), { recursive: true });
  await writeFile(stateFile(), JSON.stringify({ folder, entries: Object.fromEntries(entries) } satisfies SavedSyncState));
}

const mtimeOf = (e: Entry) => new Date(e.modified).getTime();
const sameFile = (a: { size: number; mtime: number }, b: { size: number; mtime: number }) =>
  a.size === b.size && Math.abs(a.mtime - b.mtime) <= MTIME_TOLERANCE;
const asFile = (e: Entry) => ({ size: e.size, mtime: mtimeOf(e) });
const fromBase = (b: [number, number]) => ({ size: b[0], mtime: b[1] });

async function pullFile(remote: Entry, rel: string, remotePath: string) {
  rt.status.current = rel;
  const res = await api(`/api/download?path=${encodeURIComponent(remotePath)}`);
  if (!res.ok || !res.body) throw new Error(`Couldn’t download ${rel} (${res.status})`);
  await mkdir(partsDir(), { recursive: true });
  const tmp = join(partsDir(), `pull-${randomBytes(8).toString('hex')}.part`);
  try {
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(tmp));
    await placeFile(tmp, rel, mtimeOf(remote));
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
  rt.status.pulled++;
  rt.status.doneBytes += remote.size;
}

// Given paths to delete on one side, removes whole folders when everything in
// them is going away and the other side no longer has the folder.
function collapseDeletes(paths: string[], side: Map<string, Entry>, other: Map<string, unknown>): string[] {
  const del = new Set(paths);
  const filesUnder = new Map<string, number>();
  const deletedUnder = new Map<string, number>();
  const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  for (const e of side.values()) {
    for (let p = parent(e.path); p; p = parent(p)) {
      filesUnder.set(p, (filesUnder.get(p) ?? 0) + 1);
      if (del.has(e.path)) deletedUnder.set(p, (deletedUnder.get(p) ?? 0) + 1);
    }
  }
  const targets = new Set<string>();
  for (const path of paths) {
    let target = path;
    for (let p = parent(path); p; p = parent(p)) {
      if (other.has(p) || deletedUnder.get(p) !== filesUnder.get(p)) break;
      target = p;
    }
    targets.add(target);
  }
  const sorted = Array.from(targets).sort();
  return sorted.filter((t) => !sorted.some((o) => o !== t && t.startsWith(`${o}/`)));
}

export async function runSync(): Promise<void> {
  const config = await loadConfig();
  if (!config.serverUrl || config.token === null || !config.enabled) {
    rt.status.state = baseState(config);
    return;
  }
  if (rt.running) {
    rt.rerun = true;
    return;
  }
  rt.running = true;
  runFailed.clear();
  Object.assign(rt.status, {
    state: 'scanning',
    lastError: null,
    totalFiles: 0,
    doneFiles: 0,
    failedFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
    deleted: 0,
    pulled: 0,
    deletedLocal: 0,
    conflicts: 0,
    unchanged: 0,
    current: null,
    nextRunAt: null,
  } satisfies Partial<SyncStatus>);

  try {
    const prefix = `${config.folder}/`;
    const remotePathOf = (rel: string) => prefix + rel;
    const skipPath = (path: string, isDir: boolean) => config.skipRebuildable && rebuildableKind(path, isDir) !== null;

    const localAll = await getIndex();
    const listRes = await api('/api/files?refresh=1');
    if (!listRes.ok) throw new Error(`The server returned an error (${listRes.status}).`);
    const remoteAll = new Map<string, Entry>();
    for (const e of ((await listRes.json()).entries as Entry[]) ?? []) {
      if (e.path.startsWith(prefix)) remoteAll.set(e.path.slice(prefix.length), { ...e, path: e.path.slice(prefix.length) });
    }
    const local = new Map(Array.from(localAll.values()).filter((e) => !skipPath(e.path, e.type === 'dir')).map((e) => [e.path, e]));
    const remote = new Map(Array.from(remoteAll.values()).filter((e) => !skipPath(e.path, e.type === 'dir')).map((e) => [e.path, e]));
    const base = await loadState(config.folder);

    if (local.size === 0 && remote.size > 0) {
      throw new Error('The shared folder looks empty (is the drive connected?). Sync paused so nothing gets removed.');
    }

    const push: Entry[] = [];
    const pull: Entry[] = [];
    const check: Entry[] = [];
    const deleteRemote: string[] = [];
    const deleteLocal: string[] = [];
    const localFiles = new Map(Array.from(local.values()).filter((e) => e.type === 'file').map((e) => [e.path, e]));
    const remoteFiles = new Map(Array.from(remote.values()).filter((e) => e.type === 'file').map((e) => [e.path, e]));

    for (const rel of new Set([...localFiles.keys(), ...remoteFiles.keys()])) {
      const L = localFiles.get(rel);
      const R = remoteFiles.get(rel);
      const b = base.get(rel);
      const B = Array.isArray(b) ? fromBase(b) : null;
      if (L && R) {
        if (sameFile(asFile(L), asFile(R))) {
          rt.status.unchanged++;
          continue;
        }
        const localChanged = !B || !sameFile(asFile(L), B);
        const remoteChanged = !B || !sameFile(asFile(R), B);
        if (!config.twoWay || (localChanged && !remoteChanged)) push.push(L);
        else if (remoteChanged && !localChanged) pull.push(R);
        else if (L.size === R.size) check.push(L);
        else {
          rt.status.conflicts++;
          if (mtimeOf(L) >= mtimeOf(R)) push.push(L);
          else pull.push(R);
        }
      } else if (L) {
        if (config.twoWay && B && sameFile(asFile(L), B)) deleteLocal.push(rel);
        else push.push(L);
      } else if (R) {
        if (B && sameFile(asFile(R), B)) {
          if (config.mirrorDeletes) deleteRemote.push(rel);
        } else if (config.twoWay) pull.push(R);
        else if (config.mirrorDeletes) deleteRemote.push(rel);
      }
    }

    // Same size, different dates: compare contents before deciding.
    for (let i = 0; i < check.length; i += 300) {
      const group = check.slice(i, i + 300);
      const items = await Promise.all(group.map(async (e) => ({ path: remotePathOf(e.path), sha256: await hashLocal(e.path).catch(() => ''), mtime: mtimeOf(e) })));
      const res = await api('/api/files/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      const matched = new Set<string>(res.ok ? (await res.json()).matched : []);
      for (const L of group) {
        if (matched.has(remotePathOf(L.path))) {
          rt.status.unchanged++;
          const R = remoteFiles.get(L.path);
          if (R) remoteFiles.set(L.path, { ...R, modified: L.modified });
          continue;
        }
        const R = remoteFiles.get(L.path)!;
        rt.status.conflicts++;
        if (!config.twoWay || mtimeOf(L) >= mtimeOf(R)) push.push(L);
        else pull.push(R);
      }
    }

    // Guards against mass removal when one side looks wiped.
    const guard = (count: number, of: number, where: string) => {
      if (count > 200 && count > of / 2) {
        rt.status.lastError = `Skipped removing ${count.toLocaleString()} files ${where} because that’s more than half of them. Remove them yourself if that was intended.`;
        return true;
      }
      return false;
    };
    if (guard(deleteRemote.length, remoteFiles.size, 'from the server')) deleteRemote.length = 0;
    if (guard(deleteLocal.length, localFiles.size, 'from this PC')) deleteLocal.length = 0;

    rt.status.state = 'syncing';
    rt.status.totalFiles = push.length + pull.length;
    rt.status.totalBytes = push.reduce((a, e) => a + e.size, 0) + pull.reduce((a, e) => a + e.size, 0);

    const onFail = (rels: string[], error: unknown) => {
      if (error instanceof SignedOutError || (error as { offline?: boolean }).offline) throw error;
      rt.status.failedFiles += rels.length;
      for (const r of rels) runFailed.add(r);
      rt.status.lastError = error instanceof Error ? error.message : 'Some files failed';
    };

    const small = push.filter((e) => e.size <= SMALL_FILE);
    const large = push.filter((e) => e.size > SMALL_FILE);
    const batches: Entry[][] = [];
    let current: Entry[] = [];
    let bytes = 0;
    for (const e of small) {
      if (current.length && (current.length >= BATCH_FILES || bytes + e.size > BATCH_BYTES)) {
        batches.push(current);
        current = [];
        bytes = 0;
      }
      current.push(e);
      bytes += e.size;
    }
    if (current.length) batches.push(current);

    await pool(batches, (b) => uploadBatch(b, remotePathOf).catch((e) => onFail(b.map((x) => x.path), e)));
    await pool(large, (e) => uploadLarge(e, remotePathOf(e.path)).catch((err) => onFail([e.path], err)));
    await pool(pull, (R) => pullFile(R, R.path, remotePathOf(R.path)).catch((err) => onFail([R.path], err)));

    // Empty folders: create on the side that lacks them, unless they were removed there.
    const emptyDirs = (side: Map<string, Entry>) => {
      const hasChildren = new Set<string>();
      for (const e of side.values()) if (e.path.includes('/')) hasChildren.add(e.path.slice(0, e.path.lastIndexOf('/')));
      return Array.from(side.values()).filter((e) => e.type === 'dir' && !hasChildren.has(e.path));
    };
    for (const d of emptyDirs(local)) {
      if (remote.has(d.path)) continue;
      if (base.get(d.path) === -1 && config.twoWay) deleteLocal.push(d.path);
      else await api('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: remotePathOf(d.path) }) });
    }
    if (config.twoWay) {
      for (const d of emptyDirs(remote)) {
        if (local.has(d.path)) continue;
        if (base.get(d.path) === -1) {
          if (config.mirrorDeletes) deleteRemote.push(d.path);
        } else await makeFolder(d.path).catch(() => {});
      }
    }

    for (const rel of collapseDeletes(deleteRemote, remote, local)) {
      const res = await api(`/api/files?path=${encodeURIComponent(remotePathOf(rel))}`, { method: 'DELETE' });
      if (res.ok) rt.status.deleted++;
    }
    for (const rel of collapseDeletes(deleteLocal, local, remote)) {
      await moveToTrash(rel, 'deleted')
        .then(() => rt.status.deletedLocal++)
        .catch(() => {});
    }

    // Record the agreed state; failed paths keep their previous record.
    const after = await getIndex();
    const next = new Map<string, [number, number] | -1>();
    for (const e of after.values()) {
      if (skipPath(e.path, e.type === 'dir')) continue;
      if (runFailed.has(e.path)) {
        const prev = base.get(e.path);
        if (prev !== undefined) next.set(e.path, prev);
        continue;
      }
      next.set(e.path, e.type === 'dir' ? -1 : [e.size, mtimeOf(e)]);
    }
    await saveState(config.folder, next);

    config.lastSyncAt = new Date().toISOString();
    rt.status.lastSyncAt = config.lastSyncAt;
    rt.status.state = 'idle';
    await saveConfig();
    await announce().catch(() => {});
  } catch (error) {
    if (error instanceof SignedOutError) {
      rt.status.state = 'signed-out';
      config.token = null;
      await saveConfig();
    } else if ((error as { offline?: boolean }).offline) {
      rt.status.state = 'offline';
    } else {
      rt.status.state = 'error';
    }
    rt.status.lastError = error instanceof Error ? error.message : 'Sync failed';
  } finally {
    rt.running = false;
    rt.status.current = null;
    if (rt.rerun) {
      rt.rerun = false;
      triggerSync(2000);
    } else if (rt.config?.enabled && rt.config.serverUrl && rt.config.token !== null) {
      triggerSync(INTERVAL_MS);
    }
  }
}
