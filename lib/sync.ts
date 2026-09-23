// Backs up the local NAS folder to a server NAS ("chain"). Runs only in local
// mode. It never deletes anything on this PC; with mirroring on, files removed
// here are moved to the server's Trash (kept 30 days), not erased.

import { createHash, randomBytes } from 'crypto';
import { mkdir, open, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { lanUrls } from '@/lib/instance';
import { rebuildableKind } from '@/lib/rebuildable';
import { type Entry, absolutePath, getIndex, nasMode, onExternalChange, systemDir } from '@/lib/storage';

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

export async function updateSync(patch: Partial<Pick<SyncConfig, 'enabled' | 'skipRebuildable' | 'mirrorDeletes' | 'folder'>>) {
  const config = await loadConfig();
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
  if (res.status === 401) throw new SignedOutError('The server password changed. Reconnect to keep backing up.');
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
    } else rt.status.failedFiles++;
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
  Object.assign(rt.status, {
    state: 'scanning',
    lastError: null,
    totalFiles: 0,
    doneFiles: 0,
    failedFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
    deleted: 0,
    unchanged: 0,
    current: null,
    nextRunAt: null,
  } satisfies Partial<SyncStatus>);

  try {
    const prefix = `${config.folder}/`;
    const remotePathOf = (rel: string) => prefix + rel;
    const skip = (e: Entry) => config.skipRebuildable && rebuildableKind(e.path, e.type === 'dir') !== null;

    const local = await getIndex();
    const listRes = await api('/api/files');
    if (!listRes.ok) throw new Error(`The server returned an error (${listRes.status}).`);
    const remote = new Map<string, Entry>();
    for (const e of ((await listRes.json()).entries as Entry[]) ?? []) {
      if (e.path.startsWith(prefix)) remote.set(e.path.slice(prefix.length), e);
    }

    if (local.size === 0 && remote.size > 0) {
      throw new Error('The shared folder looks empty (is the drive connected?). Backup paused so the server copy stays safe.');
    }

    const toUpload: Entry[] = [];
    const toCheck: Entry[] = [];
    const hasChildren = new Set<string>();
    for (const e of local.values()) {
      if (e.path.includes('/')) hasChildren.add(e.path.slice(0, e.path.lastIndexOf('/')));
    }
    for (const e of local.values()) {
      if (e.type !== 'file' || skip(e)) continue;
      const r = remote.get(e.path);
      if (!r || r.type !== 'file' || r.size !== e.size) toUpload.push(e);
      else if (Math.abs(new Date(r.modified).getTime() - new Date(e.modified).getTime()) > MTIME_TOLERANCE) toCheck.push(e);
      else rt.status.unchanged++;
    }

    for (let i = 0; i < toCheck.length; i += 300) {
      const group = toCheck.slice(i, i + 300);
      const items = await Promise.all(
        group.map(async (e) => ({ path: remotePathOf(e.path), sha256: await hashLocal(e.path).catch(() => ''), mtime: new Date(e.modified).getTime() })),
      );
      const res = await api('/api/files/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      const matched = new Set<string>(res.ok ? (await res.json()).matched : []);
      group.forEach((e) => {
        if (matched.has(remotePathOf(e.path))) rt.status.unchanged++;
        else toUpload.push(e);
      });
    }

    rt.status.state = 'syncing';
    rt.status.totalFiles = toUpload.length;
    rt.status.totalBytes = toUpload.reduce((a, e) => a + e.size, 0);

    const small = toUpload.filter((e) => e.size <= SMALL_FILE);
    const large = toUpload.filter((e) => e.size > SMALL_FILE);
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

    const onFail = (count: number, error: unknown) => {
      if (error instanceof SignedOutError || (error as { offline?: boolean }).offline) throw error;
      rt.status.failedFiles += count;
      rt.status.lastError = error instanceof Error ? error.message : 'Some files failed';
    };
    await pool(batches, (b) => uploadBatch(b, remotePathOf).catch((e) => onFail(b.length, e)));
    await pool(large, (e) => uploadLarge(e, remotePathOf(e.path)).catch((err) => onFail(1, err)));

    for (const e of local.values()) {
      if (e.type === 'dir' && !hasChildren.has(e.path) && !remote.has(e.path) && !skip(e)) {
        await api('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: remotePathOf(e.path) }) });
      }
    }

    if (config.mirrorDeletes) {
      const gone = Array.from(remote.keys())
        .filter((rel) => !local.has(rel) && !(config.skipRebuildable && rebuildableKind(rel, remote.get(rel)!.type === 'dir')))
        .sort();
      const remoteFiles = Array.from(remote.values()).filter((e) => e.type === 'file').length;
      const goneFiles = gone.filter((rel) => remote.get(rel)!.type === 'file').length;
      if (goneFiles > 200 && goneFiles > remoteFiles / 2) {
        rt.status.lastError = `Skipped removing ${goneFiles.toLocaleString()} files from the server because that’s more than half the backup. Delete them there yourself if that was intended.`;
        gone.length = 0;
      }
      const removed: string[] = [];
      for (const rel of gone) {
        if (removed.some((d) => rel.startsWith(`${d}/`))) continue;
        const res = await api(`/api/files?path=${encodeURIComponent(remotePathOf(rel))}`, { method: 'DELETE' });
        if (res.ok) {
          removed.push(rel);
          rt.status.deleted++;
        }
      }
    }

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
    rt.status.lastError = error instanceof Error ? error.message : 'Backup failed';
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
