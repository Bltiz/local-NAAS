import { ENC_CHUNK, EncryptionSession, FileEncryptor, HEADER_LEN, encryptedSize } from '@/lib/client/crypto';

export const ENCRYPTED_SUFFIX = '.nasenc';
const CHUNK = 8 * 1024 * 1024;
const SMALL_FILE = 4 * 1024 * 1024;
const BATCH_BYTES = 8 * 1024 * 1024;
const BATCH_FILES = 500;
const VERIFY_BATCH = 300;
const MAX_REQUESTS = 6;
const MAX_LARGE = 3;
const MAX_ATTEMPTS = 6;
const LIST_LIMIT = 50;

export type UploadStatus = 'queued' | 'verifying' | 'uploading' | 'done' | 'skipped' | 'error' | 'canceled';

export interface UploadItem {
  key: string;
  path: string;
  size: number;
  status: UploadStatus;
  encrypted: boolean;
  error?: string;
}

export interface UploadSnapshot {
  totalFiles: number;
  doneFiles: number;
  skippedFiles: number;
  failedFiles: number;
  totalBytes: number;
  sentBytes: number;
  bytesPerSecond: number;
  filesPerSecond: number;
  running: boolean;
  verifying: number;
  current: UploadItem[];
  failures: UploadItem[];
  recent: string[];
}

export interface PendingUpload {
  file: File;
  path: string;
  verify?: boolean;
}

export interface SavedFile {
  path: string;
  size: number;
  modified: string;
}

interface Internal extends UploadItem {
  file: File;
  session: EncryptionSession | null;
  verify: boolean;
  sent: number;
  attempts: number;
  xhr?: XMLHttpRequest;
}

class FatalUploadError extends Error {}
class SignedOutError extends Error {}

async function sha256Hex(data: ArrayBuffer | Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Each File read holds a browser file handle; thousands at once can crash the tab.
const MAX_OPEN_READS = 32;
let openReads = 0;
const readWaiters: (() => void)[] = [];

async function readFile(blob: Blob): Promise<ArrayBuffer> {
  while (openReads >= MAX_OPEN_READS) await new Promise<void>((r) => readWaiters.push(r));
  openReads++;
  try {
    return await blob.arrayBuffer();
  } finally {
    openReads--;
    readWaiters.shift()?.();
  }
}
const storedPath = (item: Internal) => (item.encrypted ? item.path + ENCRYPTED_SUFFIX : item.path);

const EMPTY: UploadSnapshot = {
  totalFiles: 0,
  doneFiles: 0,
  skippedFiles: 0,
  failedFiles: 0,
  totalBytes: 0,
  sentBytes: 0,
  bytesPerSecond: 0,
  filesPerSecond: 0,
  running: false,
  verifying: 0,
  current: [],
  failures: [],
  recent: [],
};

export class Uploader {
  private items: Internal[] = [];
  private verifyQueue: Internal[] = [];
  private smallQueue: Internal[] = [];
  private largeQueue: Internal[] = [];
  private active = new Set<Internal>();
  private requests = 0;
  private largeRequests = 0;
  private verifying = false;
  private doneFiles = 0;
  private skippedFiles = 0;
  private doneBytes = 0;
  private recent: string[] = [];
  private listeners = new Set<() => void>();
  private snapshot: UploadSnapshot = EMPTY;
  private samples: { t: number; bytes: number; files: number }[] = [];
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private callbacks: { onSaved?: (files: SavedFile[]) => void; onSignedOut?: () => void } = {};

  setCallbacks(callbacks: { onSaved?: (files: SavedFile[]) => void; onSignedOut?: () => void }) {
    this.callbacks = callbacks;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  add(files: PendingUpload[], session: EncryptionSession | null) {
    for (const { file, path, verify } of files) {
      const encrypted = session !== null;
      const item: Internal = {
        key: `u${++this.seq}`,
        path,
        size: encrypted ? encryptedSize(file.size) : file.size,
        status: 'queued',
        encrypted,
        file,
        session,
        verify: Boolean(verify) && !encrypted,
        sent: 0,
        attempts: 0,
      };
      this.items.push(item);
      this.enqueue(item);
    }
    this.notify(true);
    this.pump();
  }

  private enqueue(item: Internal) {
    if (item.verify) this.verifyQueue.push(item);
    else if (item.size <= SMALL_FILE) this.smallQueue.push(item);
    else this.largeQueue.push(item);
  }

  retryFailed() {
    for (const item of this.items) {
      if (item.status === 'error') {
        item.status = 'queued';
        item.error = undefined;
        item.sent = 0;
        item.attempts = 0;
        item.verify = false;
        this.enqueue(item);
      }
    }
    this.notify(true);
    this.pump();
  }

  cancelAll() {
    this.verifyQueue = [];
    this.smallQueue = [];
    this.largeQueue = [];
    for (const item of this.items) {
      if (item.status === 'queued' || item.status === 'uploading' || item.status === 'verifying') {
        item.status = 'canceled';
        item.xhr?.abort();
      }
    }
    this.notify(true);
  }

  clearFinished() {
    if (this.snapshot.running) return;
    this.items = [];
    this.doneFiles = 0;
    this.skippedFiles = 0;
    this.doneBytes = 0;
    this.recent = [];
    this.samples = [];
    this.notify(true);
  }

  private pump() {
    if (!this.verifying && this.verifyQueue.length > 0) {
      this.verifying = true;
      this.runVerify(this.verifyQueue.splice(0, VERIFY_BATCH)).finally(() => {
        this.verifying = false;
        this.pump();
      });
    }
    while (this.requests < MAX_REQUESTS) {
      if (this.largeQueue.length > 0 && this.largeRequests < MAX_LARGE) {
        const item = this.largeQueue.shift()!;
        if (item.status !== 'queued') continue;
        this.requests++;
        this.largeRequests++;
        this.runLarge(item).finally(() => {
          this.requests--;
          this.largeRequests--;
          this.pump();
        });
        continue;
      }
      const batch = this.takeBatch();
      if (batch.length === 0) break;
      this.requests++;
      this.runBatch(batch).finally(() => {
        this.requests--;
        this.pump();
      });
    }
    this.notify();
  }

  private takeBatch(): Internal[] {
    const batch: Internal[] = [];
    let bytes = 0;
    while (this.smallQueue.length > 0 && batch.length < BATCH_FILES) {
      const next = this.smallQueue[0];
      if (next.status !== 'queued') {
        this.smallQueue.shift();
        continue;
      }
      if (batch.length > 0 && bytes + next.size > BATCH_BYTES) break;
      batch.push(this.smallQueue.shift()!);
      bytes += next.size;
    }
    return batch;
  }

  private markDone(item: Internal) {
    if (item.status === 'done' || item.status === 'skipped') return;
    item.status = 'done';
    item.sent = item.size;
    this.doneFiles++;
    this.doneBytes += item.size;
    this.active.delete(item);
    this.recent.unshift(item.path);
    if (this.recent.length > 5) this.recent.pop();
  }

  private markFailed(item: Internal, message: string) {
    if (item.status === 'canceled') return;
    item.status = 'error';
    item.error = message;
    this.active.delete(item);
  }

  private handleError(items: Internal[], error: unknown) {
    if (error instanceof SignedOutError) {
      for (const i of items) this.markFailed(i, 'Signed out');
      this.callbacks.onSignedOut?.();
    } else {
      const message = error instanceof Error ? error.message : 'Upload failed';
      for (const i of items) this.markFailed(i, message);
    }
  }

  // Files already on the NAS with the same size but a different date: compare
  // checksums and skip the identical ones.
  private async runVerify(items: Internal[]) {
    const live = items.filter((i) => i.status === 'queued');
    for (const i of live) i.status = 'verifying';
    this.notify(true);
    try {
      const hashed = await Promise.all(
        live.map(async (i) => ({ item: i, sha256: await sha256Hex(await readFile(i.file)) })),
      );
      const res = await fetch('/api/files/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: hashed.map((h) => ({ path: h.item.path, sha256: h.sha256, mtime: h.item.file.lastModified })) }),
      });
      if (res.status === 401) throw new SignedOutError();
      const matched = new Set<string>(res.ok ? (await res.json()).matched : []);
      const saved: SavedFile[] = [];
      for (const { item } of hashed) {
        if (item.status !== 'verifying') continue;
        if (matched.has(item.path)) {
          item.status = 'skipped';
          this.skippedFiles++;
          this.doneBytes += item.size;
          saved.push({ path: item.path, size: item.size, modified: new Date(item.file.lastModified).toISOString() });
        } else {
          item.status = 'queued';
          item.verify = false;
          this.enqueue(item);
        }
      }
      if (saved.length) this.callbacks.onSaved?.(saved);
    } catch (error) {
      if (error instanceof SignedOutError) return this.handleError(live, error);
      for (const item of live) {
        if (item.status !== 'verifying') continue;
        item.status = 'queued';
        item.verify = false;
        this.enqueue(item);
      }
    }
  }

  private async runBatch(items: Internal[]) {
    for (const i of items) {
      i.status = 'uploading';
      this.active.add(i);
    }
    this.notify(true);
    try {
      const encoded = await Promise.all(
        items.map(async (item) => {
          let data: Uint8Array<ArrayBuffer> = new Uint8Array(await readFile(item.file));
          if (item.session) {
            const enc = await FileEncryptor.create(item.session);
            const cipher = new Uint8Array(await enc.encryptChunk(data.buffer, 0, true));
            const joined = new Uint8Array(HEADER_LEN + cipher.length);
            joined.set(enc.header, 0);
            joined.set(cipher, HEADER_LEN);
            data = joined;
          }
          return { item, data, sha256: await sha256Hex(data) };
        }),
      );
      const manifest = new TextEncoder().encode(
        JSON.stringify({
          files: encoded.map((e) => ({ path: storedPath(e.item), size: e.data.length, mtime: e.item.file.lastModified, sha256: e.sha256 })),
        }),
      );
      const head = new Uint8Array(4);
      new DataView(head.buffer).setUint32(0, manifest.length);
      const body = new Blob([head, manifest, ...encoded.map((e) => e.data)]);

      let lastError = 'Upload failed';
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(Math.min(16000, 1000 * 2 ** (attempt - 1)));
        if (items.every((i) => i.status !== 'uploading')) return;
        const holder = { xhr: undefined as XMLHttpRequest | undefined };
        const pending = this.send('/api/upload/batch', body, {}, holder, (loaded) => {
          let remaining = loaded;
          for (const e of encoded) {
            e.item.sent = Math.min(e.item.size, remaining);
            remaining -= e.item.sent;
          }
          this.notify();
        });
        for (const i of items) i.xhr = holder.xhr;
        const { status, json } = await pending.catch((error) => ({
          status: 0,
          json: { error: error instanceof Error ? error.message : 'Network error' } as Record<string, unknown>,
        }));
        if (status === 401) throw new SignedOutError();
        if (status === 200) {
          const results = (json.results ?? []) as { path: string; ok: boolean; savedAs?: string; size?: number; error?: string }[];
          const saved: SavedFile[] = [];
          encoded.forEach((e, idx) => {
            const r = results[idx];
            if (r?.ok) {
              this.markDone(e.item);
              saved.push({ path: r.savedAs ?? storedPath(e.item), size: e.data.length, modified: new Date(e.item.file.lastModified).toISOString() });
            } else if (r?.error === 'Invalid path' || e.item.attempts >= 2) {
              this.markFailed(e.item, r?.error ?? 'Upload failed');
            } else {
              e.item.attempts++;
              e.item.status = 'queued';
              e.item.sent = 0;
              this.active.delete(e.item);
              this.smallQueue.push(e.item);
            }
          });
          if (saved.length) this.callbacks.onSaved?.(saved);
          return;
        }
        if (status === 400 || status === 413) throw new FatalUploadError(String(json.error ?? 'Rejected by server'));
        lastError = String(json.error ?? `Server error (${status})`);
      }
      throw new Error(`${lastError} after ${MAX_ATTEMPTS} attempts`);
    } catch (error) {
      this.handleError(items.filter((i) => i.status === 'uploading'), error);
    } finally {
      this.notify(true);
    }
  }

  private async runLarge(item: Internal) {
    item.status = 'uploading';
    this.active.add(item);
    this.notify(true);
    try {
      const saved = await this.uploadChunked(item);
      if (item.status === 'uploading') {
        this.markDone(item);
        this.callbacks.onSaved?.([saved]);
      }
    } catch (error) {
      if ((item.status as UploadStatus) !== 'canceled') this.handleError([item], error);
    } finally {
      item.xhr = undefined;
      this.notify(true);
    }
  }

  private async uploadChunked(item: Internal): Promise<SavedFile> {
    const { file, session } = item;
    const path = storedPath(item);
    const total = item.size;
    const encryptor = session ? await FileEncryptor.create(session) : null;
    const mtime = file.lastModified;

    // Plain uploads get a stable id so an interrupted large file resumes where it stopped.
    const id = encryptor ? randomHex(16) : (await sha256Hex(`${path}|${file.size}|${mtime}`)).slice(0, 32);
    let offset = 0;
    if (!encryptor) {
      const res = await fetch(`/api/upload?id=${id}`);
      if (res.status === 401) throw new SignedOutError();
      offset = res.ok ? ((await res.json()).received ?? 0) : 0;
      if (offset > total) offset = 0;
    }

    for (;;) {
      if (item.status !== 'uploading') throw new Error('Canceled');
      let body: ArrayBuffer;
      if (encryptor) {
        const index = offset === 0 ? 0 : (offset - HEADER_LEN) / (ENC_CHUNK + 16);
        if (!Number.isInteger(index)) {
          await fetch(`/api/upload?id=${id}`, { method: 'DELETE' });
          offset = 0;
          continue;
        }
        const chunkTotal = Math.max(1, Math.ceil(file.size / ENC_CHUNK));
        const plain = await readFile(file.slice(index * ENC_CHUNK, (index + 1) * ENC_CHUNK));
        const cipher = new Uint8Array(await encryptor.encryptChunk(plain, index, index === chunkTotal - 1));
        if (index === 0) {
          const joined = new Uint8Array(HEADER_LEN + cipher.length);
          joined.set(encryptor.header, 0);
          joined.set(cipher, HEADER_LEN);
          body = joined.buffer;
        } else {
          body = cipher.buffer;
        }
      } else {
        body = await readFile(file.slice(offset, Math.min(offset + CHUNK, total)));
      }

      const sha = await sha256Hex(body);
      const url = `/api/upload?id=${id}&path=${encodeURIComponent(path)}&offset=${offset}&total=${total}&mtime=${mtime}`;
      const result = await this.putChunk(item, url, body, sha, offset);
      offset = result.received;
      item.sent = offset;
      this.notify();
      if (result.done) return { path: result.path ?? path, size: total, modified: new Date(mtime).toISOString() };
    }
  }

  private async putChunk(item: Internal, url: string, body: ArrayBuffer, sha: string, baseOffset: number) {
    let lastError = 'Upload failed';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(Math.min(16000, 1000 * 2 ** (attempt - 1)));
      if (item.status !== 'uploading') throw new Error('Canceled');
      try {
        const holder = { xhr: undefined as XMLHttpRequest | undefined };
        const pending = this.send(url, body, { 'x-chunk-sha256': sha }, holder, (loaded) => {
          item.sent = baseOffset + loaded;
          this.notify();
        });
        item.xhr = holder.xhr;
        const { status, json } = await pending;
        if (status === 200) return json as { received: number; done: boolean; path?: string };
        if (status === 401) throw new SignedOutError();
        if (status === 409) return { received: Number(json.received ?? 0), done: false };
        if (status === 400 || status === 413) throw new FatalUploadError(String(json.error ?? 'Rejected by server'));
        lastError = String(json.error ?? `Server error (${status})`);
      } catch (error) {
        if (error instanceof SignedOutError || error instanceof FatalUploadError) throw error;
        lastError = error instanceof Error ? error.message : 'Network error';
      }
    }
    throw new Error(`${lastError} after ${MAX_ATTEMPTS} attempts`);
  }

  private send(
    url: string,
    body: ArrayBuffer | Blob,
    headers: Record<string, string>,
    holder: { xhr?: XMLHttpRequest },
    onProgress: (loaded: number) => void,
  ) {
    return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      holder.xhr = xhr;
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () => {
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(xhr.responseText);
        } catch {}
        resolve({ status: xhr.status, json });
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onabort = () => reject(new Error('Canceled'));
      xhr.send(body);
    });
  }

  private notify(immediate = false) {
    if (immediate) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
      this.emit();
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.emit();
    }, 200);
  }

  private emit() {
    let totalFiles = 0;
    let totalBytes = 0;
    let failedFiles = 0;
    const failures: UploadItem[] = [];
    for (const i of this.items) {
      if (i.status === 'canceled') continue;
      totalFiles++;
      totalBytes += i.size;
      if (i.status === 'error') {
        failedFiles++;
        if (failures.length < LIST_LIMIT) failures.push(this.view(i));
      }
    }
    let inflight = 0;
    const current: UploadItem[] = [];
    for (const i of this.active) {
      inflight += Math.min(i.sent, i.size);
      if (current.length < 8) current.push(this.view(i));
    }
    const sentBytes = this.doneBytes + inflight;
    const finished = this.doneFiles + this.skippedFiles;
    const running = finished + failedFiles < totalFiles;

    const now = performance.now();
    this.samples.push({ t: now, bytes: sentBytes, files: finished });
    while (this.samples.length > 2 && now - this.samples[0].t > 5000) this.samples.shift();
    const first = this.samples[0];
    const elapsed = (now - first.t) / 1000;
    const pending = this.verifyQueue.length + (this.verifying ? 1 : 0);

    this.snapshot = {
      totalFiles,
      doneFiles: this.doneFiles,
      skippedFiles: this.skippedFiles,
      failedFiles,
      totalBytes,
      sentBytes,
      bytesPerSecond: running && elapsed > 0.5 ? Math.max(0, (sentBytes - first.bytes) / elapsed) : 0,
      filesPerSecond: running && elapsed > 0.5 ? Math.max(0, (finished - first.files) / elapsed) : 0,
      running,
      verifying: pending ? this.items.filter((i) => i.status === 'verifying').length + this.verifyQueue.length : 0,
      current,
      failures,
      recent: [...this.recent],
    };
    for (const listener of this.listeners) listener();
  }

  private view(i: Internal): UploadItem {
    return { key: i.key, path: i.path, size: i.size, status: i.status, encrypted: i.encrypted, error: i.error };
  }
}
