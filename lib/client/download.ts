import { EncryptionSession, decryptStream, plainSizeOf } from '@/lib/client/crypto';
import { ENCRYPTED_SUFFIX } from '@/lib/client/upload';

export interface FileEntry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  modified: string;
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

const pickerWindow = () => window as unknown as SaveFilePickerWindow;

export const supportsFolderSave = () => typeof window !== 'undefined' && !!pickerWindow().showDirectoryPicker;

export function isEncrypted(path: string): boolean {
  return path.endsWith(ENCRYPTED_SUFFIX);
}

export function displayName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return isEncrypted(name) ? name.slice(0, -ENCRYPTED_SUFFIX.length) : name;
}

export function displaySize(entry: FileEntry): number {
  return isEncrypted(entry.path) ? Math.max(0, plainSizeOf(entry.size)) : entry.size;
}

export const downloadUrl = (path: string, inline = false) =>
  `/api/download?path=${encodeURIComponent(path)}${inline ? '&inline=1' : ''}`;

// Where file bytes come from: the signed-in NAS, or a public share link.
export interface FileSource {
  url: (path: string, inline?: boolean) => string;
  onUnauthorized?: () => void;
}

export const nasSource: FileSource = {
  url: downloadUrl,
  onUnauthorized: () => window.location.replace('/login'),
};

export class NeedsPassphraseError extends Error {
  constructor() {
    super('Unlock encrypted files first.');
  }
}

async function openStream(entry: FileEntry, session: EncryptionSession | null, source: FileSource): Promise<ReadableStream<Uint8Array>> {
  if (isEncrypted(entry.path) && !session) throw new NeedsPassphraseError();
  const res = await fetch(source.url(entry.path));
  if (res.status === 401) {
    source.onUnauthorized?.();
    throw new Error('Signed out');
  }
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  if (!isEncrypted(entry.path)) return res.body;
  if (!session) throw new NeedsPassphraseError();
  return res.body.pipeThrough(decryptStream(session, entry.size));
}

function triggerDownload(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadFile(entry: FileEntry, session: EncryptionSession | null, source: FileSource = nasSource): Promise<void> {
  const name = displayName(entry.path);
  if (!isEncrypted(entry.path)) {
    triggerDownload(source.url(entry.path), name);
    return;
  }
  if (!session) throw new NeedsPassphraseError();
  const picker = pickerWindow().showSaveFilePicker;
  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({ suggestedName: name });
    } catch {
      return;
    }
    const writable = await handle.createWritable();
    await (await openStream(entry, session, source)).pipeTo(writable);
    return;
  }
  const blob = await new Response(await openStream(entry, session, source)).blob();
  const url = URL.createObjectURL(blob);
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function readAsBlob(
  entry: FileEntry,
  session: EncryptionSession | null,
  type: string,
  source: FileSource = nasSource,
): Promise<Blob> {
  const blob = await new Response(await openStream(entry, session, source)).blob();
  return new Blob([blob], { type });
}

// Writes every file under folderPath into a user-chosen directory, keeping structure.
export async function downloadFolder(
  folderPath: string,
  entries: FileEntry[],
  session: EncryptionSession | null,
  onProgress: (done: number, total: number) => void,
  source: FileSource = nasSource,
  rootName?: string,
): Promise<'saved' | 'fallback' | 'canceled'> {
  // An empty folderPath means "everything in entries" (used for shared folders).
  const prefix = folderPath ? `${folderPath}/` : '';
  const files = entries.filter((e) => e.type === 'file' && e.path.startsWith(prefix));
  const dirs = entries.filter((e) => e.type === 'dir' && e.path.startsWith(prefix));
  if (files.some((f) => isEncrypted(f.path)) && !session) throw new NeedsPassphraseError();

  const picker = pickerWindow().showDirectoryPicker;
  if (!picker) {
    for (const [i, f] of files.entries()) {
      await downloadFile(f, session, source);
      onProgress(i + 1, files.length);
      await new Promise((r) => setTimeout(r, 250));
    }
    return 'fallback';
  }

  let root: FileSystemDirectoryHandle;
  try {
    root = await picker({ mode: 'readwrite' });
  } catch {
    return 'canceled';
  }
  const top = await root.getDirectoryHandle(rootName ?? displayName(folderPath), { create: true });
  const dirCache = new Map<string, Promise<FileSystemDirectoryHandle>>([['', Promise.resolve(top)]]);
  const dirFor = (rel: string): Promise<FileSystemDirectoryHandle> => {
    let handle = dirCache.get(rel);
    if (!handle) {
      const slash = rel.lastIndexOf('/');
      const parent = slash < 0 ? '' : rel.slice(0, slash);
      const name = rel.slice(slash + 1);
      handle = dirFor(parent).then((p) => p.getDirectoryHandle(name, { create: true }));
      dirCache.set(rel, handle);
    }
    return handle;
  };

  for (const d of dirs) await dirFor(d.path.slice(prefix.length));

  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const rel = f.path.slice(prefix.length);
      const slash = rel.lastIndexOf('/');
      const dir = await dirFor(slash < 0 ? '' : rel.slice(0, slash));
      const handle = await dir.getFileHandle(displayName(rel), { create: true });
      const writable = await handle.createWritable();
      await (await openStream(f, session, source)).pipeTo(writable);
      onProgress(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  return 'saved';
}
