import { ENC_CHUNK, EncryptionSession, FileEncryptor, HEADER_LEN, encryptedSize } from '@/lib/client/crypto';

export const ENCRYPTED_SUFFIX = '.nasenc';
const CHUNK = 8 * 1024 * 1024;
const MAX_ACTIVE = 6;
const MAX_ATTEMPTS = 6;

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled';

export interface UploadItem {
  key: string;
  name: string;
  path: string;
  size: number;
  sent: number;
  status: UploadStatus;
  encrypted: boolean;
  error?: string;
}

export interface UploadSnapshot {
  items: UploadItem[];
  totalBytes: number;
  sentBytes: number;
  bytesPerSecond: number;
  active: number;
  failed: number;
  done: number;
}

export interface PendingUpload {
  file: File;
  path: string;
}

interface Internal extends UploadItem {
  file: File;
  session: EncryptionSession | null;
  xhr?: XMLHttpRequest;
}

class FatalUploadError extends Error {}
class SignedOutError extends Error {}

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Uploader {
  private items: Internal[] = [];
  private listeners = new Set<() => void>();
  private snapshot: UploadSnapshot = { items: [], totalBytes: 0, sentBytes: 0, bytesPerSecond: 0, active: 0, failed: 0, done: 0 };
  private samples: { t: number; bytes: number }[] = [];
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  private callbacks: { onFileDone?: (path: string) => void; onSignedOut?: () => void } = {};

  setCallbacks(callbacks: { onFileDone?: (path: string) => void; onSignedOut?: () => void }) {
    this.callbacks = callbacks;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  add(files: PendingUpload[], session: EncryptionSession | null) {
    for (const { file, path } of files) {
      const encrypted = session !== null;
      this.items.push({
        key: `u${++this.seq}`,
        name: file.name,
        path,
        size: encrypted ? encryptedSize(file.size) : file.size,
        sent: 0,
        status: 'queued',
        encrypted,
        file,
        session,
      });
    }
    this.notify(true);
    this.pump();
  }

  retryFailed() {
    for (const item of this.items) {
      if (item.status === 'error') {
        item.status = 'queued';
        item.error = undefined;
        item.sent = 0;
      }
    }
    this.notify(true);
    this.pump();
  }

  cancelAll() {
    for (const item of this.items) {
      if (item.status === 'queued' || item.status === 'uploading') {
        item.status = 'canceled';
        item.xhr?.abort();
      }
    }
    this.notify(true);
  }

  clearFinished() {
    this.items = this.items.filter((i) => i.status === 'queued' || i.status === 'uploading');
    if (this.items.length === 0) this.samples = [];
    this.notify(true);
  }

  private pump() {
    let active = this.items.filter((i) => i.status === 'uploading').length;
    for (const item of this.items) {
      if (active >= MAX_ACTIVE) break;
      if (item.status !== 'queued') continue;
      item.status = 'uploading';
      active++;
      this.run(item);
    }
  }

  private async run(item: Internal) {
    try {
      const finalPath = await this.uploadOne(item);
      if (item.status === 'uploading') {
        item.status = 'done';
        item.sent = item.size;
        this.callbacks.onFileDone?.(finalPath);
      }
    } catch (error) {
      if (item.status === 'canceled') {
        // left as canceled
      } else if (error instanceof SignedOutError) {
        item.status = 'error';
        item.error = 'Signed out';
        this.callbacks.onSignedOut?.();
      } else {
        item.status = 'error';
        item.error = error instanceof Error ? error.message : 'Upload failed';
      }
    } finally {
      item.xhr = undefined;
      this.notify(true);
      this.pump();
    }
  }

  private async uploadOne(item: Internal): Promise<string> {
    const { file, session } = item;
    const storedPath = session ? item.path + ENCRYPTED_SUFFIX : item.path;
    const total = item.size;
    const encryptor = session ? await FileEncryptor.create(session) : null;

    // Plain uploads get a stable id so an interrupted large file resumes where it stopped.
    // Encrypted uploads use fresh salts each attempt, so their bytes can't be resumed.
    const id = encryptor ? randomHex(16) : (await sha256Hex(`${storedPath}|${file.size}|${file.lastModified}`)).slice(0, 32);
    let offset = 0;
    if (!encryptor && total > CHUNK) {
      offset = await this.fetchReceived(id);
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
        const plain = await file.slice(index * ENC_CHUNK, (index + 1) * ENC_CHUNK).arrayBuffer();
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
        body = await file.slice(offset, Math.min(offset + CHUNK, total)).arrayBuffer();
      }

      const result = await this.putWithRetry(item, { id, path: storedPath, offset, total, body });
      offset = result.received;
      item.sent = offset;
      this.notify();
      if (result.done) return result.path ?? storedPath;
    }
  }

  private async fetchReceived(id: string): Promise<number> {
    const res = await fetch(`/api/upload?id=${id}`);
    if (res.status === 401) throw new SignedOutError();
    if (!res.ok) return 0;
    return (await res.json()).received ?? 0;
  }

  private async putWithRetry(
    item: Internal,
    chunk: { id: string; path: string; offset: number; total: number; body: ArrayBuffer },
  ): Promise<{ received: number; done: boolean; path?: string }> {
    const sha = await sha256Hex(chunk.body);
    const url = `/api/upload?id=${chunk.id}&path=${encodeURIComponent(chunk.path)}&offset=${chunk.offset}&total=${chunk.total}`;
    let lastError = 'Upload failed';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(Math.min(16000, 1000 * 2 ** (attempt - 1)));
      if (item.status !== 'uploading') throw new Error('Canceled');
      try {
        const { status, json } = await this.send(item, url, chunk.body, sha, chunk.offset);
        if (status === 200) return json;
        if (status === 401) throw new SignedOutError();
        if (status === 409) return { received: json.received ?? 0, done: false };
        if (status === 400 || status === 413) throw new FatalUploadError(json.error ?? 'Rejected by server');
        lastError = json.error ?? `Server error (${status})`;
      } catch (error) {
        if (error instanceof SignedOutError || error instanceof FatalUploadError) throw error;
        lastError = error instanceof Error ? error.message : 'Network error';
      }
    }
    throw new Error(`${lastError} after ${MAX_ATTEMPTS} attempts`);
  }

  private send(item: Internal, url: string, body: ArrayBuffer, sha: string, baseOffset: number) {
    return new Promise<{ status: number; json: { received: number; done: boolean; path?: string; error?: string } }>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        item.xhr = xhr;
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('x-chunk-sha256', sha);
        xhr.upload.onprogress = (e) => {
          item.sent = baseOffset + e.loaded;
          this.notify();
        };
        xhr.onload = () => {
          let json = {} as { received: number; done: boolean; path?: string; error?: string };
          try {
            json = JSON.parse(xhr.responseText);
          } catch {}
          resolve({ status: xhr.status, json });
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.onabort = () => reject(new Error('Canceled'));
        xhr.send(body);
      },
    );
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
    }, 150);
  }

  private emit() {
    const items: UploadItem[] = this.items.map((i) => ({
      key: i.key,
      name: i.name,
      path: i.path,
      size: i.size,
      sent: i.sent,
      status: i.status,
      encrypted: i.encrypted,
      error: i.error,
    }));
    const live = items.filter((i) => i.status !== 'canceled');
    const totalBytes = live.reduce((a, i) => a + i.size, 0);
    const sentBytes = live.reduce((a, i) => a + Math.min(i.sent, i.size), 0);
    const now = performance.now();
    this.samples.push({ t: now, bytes: sentBytes });
    while (this.samples.length > 2 && now - this.samples[0].t > 3000) this.samples.shift();
    const first = this.samples[0];
    const elapsed = (now - first.t) / 1000;
    const active = items.filter((i) => i.status === 'uploading' || i.status === 'queued').length;
    this.snapshot = {
      items,
      totalBytes,
      sentBytes,
      bytesPerSecond: active && elapsed > 0.3 ? Math.max(0, (sentBytes - first.bytes) / elapsed) : 0,
      active,
      failed: items.filter((i) => i.status === 'error').length,
      done: items.filter((i) => i.status === 'done').length,
    };
    for (const listener of this.listeners) listener();
  }
}
