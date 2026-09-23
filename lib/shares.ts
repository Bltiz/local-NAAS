import { createHmac, randomBytes } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { constantTimeEqual } from '@/lib/auth';
import { StorageError, absolutePath, getIndex, normalizeRelPath, systemDir } from '@/lib/storage';
import { hashPassword, verifyPassword } from '@/lib/users';
import type { Viewer } from '@/lib/viewer';

export interface Share {
  id: string;
  path: string;
  type: 'file' | 'dir';
  createdBy: string;
  createdByName: string;
  createdAt: string;
  expiresAt: string | null;
  passwordHash: string | null;
  downloads: number;
}

export const shareCookie = (id: string) => `nas_share_${id}`;

const g = globalThis as unknown as { __nasShares?: Share[] | null };
const sharesFile = () => join(systemDir(), 'shares.json');

async function load(): Promise<Share[]> {
  if (g.__nasShares) return g.__nasShares;
  try {
    g.__nasShares = JSON.parse(await readFile(sharesFile(), 'utf8')) as Share[];
  } catch {
    g.__nasShares = [];
  }
  return g.__nasShares;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
async function save(shares: Share[], soon = false) {
  g.__nasShares = shares;
  const write = async () => {
    await mkdir(systemDir(), { recursive: true });
    await writeFile(sharesFile(), JSON.stringify(shares, null, 2));
  };
  if (!soon) return write();
  // Download counters change often; batch those writes.
  if (!saveTimer) saveTimer = setTimeout(() => ((saveTimer = null), write().catch(() => {})), 2000);
}

const isExpired = (s: Share) => s.expiresAt !== null && new Date(s.expiresAt).getTime() < Date.now();

export async function createShare(input: {
  realPath: string;
  viewer: Viewer;
  expiresInDays: number | null;
  password: string | null;
}): Promise<Share> {
  const path = normalizeRelPath(input.realPath);
  const info = await stat(absolutePath(path)).catch(() => null);
  if (!info) throw new StorageError('Not found', 404);
  if (input.password !== null && input.password.length < 4) throw new StorageError('Use at least 4 characters for the link password.', 400);
  const days = input.expiresInDays;
  const share: Share = {
    id: randomBytes(18).toString('base64url'),
    path,
    type: info.isDirectory() ? 'dir' : 'file',
    createdBy: input.viewer.id,
    createdByName: input.viewer.name,
    createdAt: new Date().toISOString(),
    expiresAt: days && days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    downloads: 0,
  };
  await save([...(await load()), share]);
  return share;
}

export async function listShares(viewer: Viewer): Promise<Share[]> {
  const all = await load();
  const live = all.filter((s) => !isExpired(s));
  if (live.length !== all.length) await save(live);
  return live.filter((s) => viewer.role === 'admin' || s.createdBy === viewer.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeShare(id: string, viewer: Viewer): Promise<void> {
  const all = await load();
  const share = all.find((s) => s.id === id);
  if (!share || (viewer.role !== 'admin' && share.createdBy !== viewer.id)) throw new StorageError('Link not found', 404);
  await save(all.filter((s) => s.id !== id));
}

export async function getShare(id: string): Promise<Share> {
  const share = (await load()).find((s) => s.id === id);
  if (!share || isExpired(share)) throw new StorageError('This link has expired or was turned off.', 404);
  return share;
}

export async function countDownload(share: Share) {
  share.downloads++;
  await save(await load(), true);
}

function unlockToken(share: Share): string {
  return createHmac('sha256', process.env.NAS_PASSWORD ?? 'local-nas').update(`share:${share.id}:${share.passwordHash}`).digest('hex');
}

export async function unlockShare(share: Share, password: string): Promise<string | null> {
  if (!share.passwordHash) return unlockToken(share);
  return (await verifyPassword(password, share.passwordHash)) ? unlockToken(share) : null;
}

export function canAccess(share: Share, cookieValue: string | undefined): boolean {
  if (!share.passwordHash) return true;
  return !!cookieValue && constantTimeEqual(cookieValue, unlockToken(share));
}

// Resolves a path inside a shared folder (or the shared file itself) to a real path.
export function sharedTarget(share: Share, inner: string | null): string {
  if (share.type === 'file') return share.path;
  return `${share.path}/${normalizeRelPath(inner)}`;
}

export async function sharedFiles(share: Share) {
  if (share.type === 'file') {
    const s = await stat(absolutePath(share.path)).catch(() => null);
    if (!s) throw new StorageError('The shared file no longer exists.', 404);
    return [{ path: share.path.slice(share.path.lastIndexOf('/') + 1), type: 'file' as const, size: s.size, modified: s.mtime.toISOString() }];
  }
  const prefix = `${share.path}/`;
  const entries = [];
  for (const e of (await getIndex()).values()) if (e.path.startsWith(prefix)) entries.push({ ...e, path: e.path.slice(prefix.length) });
  if (entries.length === 0 && !(await stat(absolutePath(share.path)).catch(() => null))) {
    throw new StorageError('The shared folder no longer exists.', 404);
  }
  return entries;
}
