import { mkdir, readFile, writeFile } from 'fs/promises';
import { networkInterfaces } from 'os';
import { join } from 'path';
import { nasMode, systemDir } from '@/lib/storage';

const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|br-|veth|Loopback|utun|tailscale|zerotier/i;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const ONLINE_MS = 3 * 60 * 1000;

export function port(): number {
  return Number(process.env.PORT) || 43214;
}

// Addresses other devices on the same network can use to reach this instance.
export function lanUrls(): string[] {
  const urls: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      urls.push(`http://${a.address}:${port()}`);
    }
  }
  return urls;
}

export interface AnnouncedInstance {
  id: string;
  name: string;
  urls: string[];
  folder: string | null;
  lastSeen: string;
  lastSyncAt: string | null;
}

const g = globalThis as unknown as { __nasInstances?: Map<string, AnnouncedInstance>; __nasInstancesLoaded?: boolean };
const registry = (g.__nasInstances ??= new Map());
const registryFile = () => join(systemDir(), 'instances.json');

async function loadRegistry() {
  if (g.__nasInstancesLoaded) return;
  g.__nasInstancesLoaded = true;
  try {
    for (const item of JSON.parse(await readFile(registryFile(), 'utf8')) as AnnouncedInstance[]) registry.set(item.id, item);
  } catch {}
}

async function saveRegistry() {
  await mkdir(systemDir(), { recursive: true });
  await writeFile(registryFile(), JSON.stringify(Array.from(registry.values())));
}

export async function announce(input: Partial<AnnouncedInstance>): Promise<void> {
  await loadRegistry();
  const id = String(input.id ?? '');
  if (!/^[a-f0-9]{16,64}$/.test(id)) throw new Error('Invalid instance id');
  const urls = (Array.isArray(input.urls) ? input.urls : [])
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(u))
    .slice(0, 8);
  registry.set(id, {
    id,
    name: String(input.name ?? 'Local PC').slice(0, 60),
    urls,
    folder: typeof input.folder === 'string' ? input.folder.slice(0, 200) : null,
    lastSeen: new Date().toISOString(),
    lastSyncAt: typeof input.lastSyncAt === 'string' ? input.lastSyncAt : null,
  });
  await saveRegistry();
}

export async function listAnnounced(): Promise<(AnnouncedInstance & { online: boolean })[]> {
  await loadRegistry();
  const now = Date.now();
  let changed = false;
  for (const [id, item] of registry) {
    if (now - new Date(item.lastSeen).getTime() > STALE_MS) {
      registry.delete(id);
      changed = true;
    }
  }
  if (changed) await saveRegistry();
  return Array.from(registry.values())
    .map((i) => ({ ...i, online: now - new Date(i.lastSeen).getTime() < ONLINE_MS }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export async function forget(id: string): Promise<void> {
  await loadRegistry();
  registry.delete(id);
  await saveRegistry();
}

export function selfInfo() {
  const mode = nasMode();
  return {
    mode,
    name: process.env.NAS_NAME || (mode === 'local' ? 'This PC' : 'Server'),
    urls: mode === 'local' ? lanUrls() : process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : [],
  };
}
