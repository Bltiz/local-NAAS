export interface PickedFile {
  file: File;
  relPath: string;
}

export interface Picked {
  files: PickedFile[];
  emptyDirs: string[];
}

export function fromFileList(list: FileList | File[]): Picked {
  return {
    files: Array.from(list, (file) => ({ file, relPath: file.webkitRelativePath || file.name })),
    emptyDirs: [],
  };
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns results in batches (~100 in Chrome) until it returns an empty batch.
  const all: FileSystemEntry[] = [];
  for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) all.push(...batch);
  return all;
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// Entries must be grabbed synchronously inside the drop handler, before any await.
export function entriesFromDrop(dt: DataTransfer): FileSystemEntry[] | null {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  if (items.length === 0 || typeof items[0].webkitGetAsEntry !== 'function') return null;
  return items.map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => e !== null);
}

// Walks dropped folders with limited parallelism, reporting how many files it has found.
export async function fromEntries(entries: FileSystemEntry[], onProgress?: (found: number) => void): Promise<Picked> {
  const out: Picked = { files: [], emptyDirs: [] };
  const queue: { entry: FileSystemEntry; prefix: string }[] = entries.map((entry) => ({ entry, prefix: '' }));
  let lastReport = 0;

  const addFiles = async (entries: FileSystemEntry[], prefix: string) => {
    for (let i = 0; i < entries.length; i += 64) {
      const files = await Promise.all(entries.slice(i, i + 64).map((e) => entryFile(e as FileSystemFileEntry)));
      files.forEach((file, j) => {
        const name = entries[i + j].name;
        out.files.push({ file, relPath: prefix ? `${prefix}/${name}` : name });
      });
      if (onProgress && out.files.length - lastReport >= 250) {
        lastReport = out.files.length;
        onProgress(out.files.length);
      }
    }
  };

  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { entry, prefix } = job;
      if (entry.isFile) {
        await addFiles([entry], prefix);
      } else if (entry.isDirectory) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
        if (children.length === 0) out.emptyDirs.push(path);
        await addFiles(children.filter((c) => c.isFile), path);
        for (const child of children) if (child.isDirectory) queue.push({ entry: child, prefix: path });
      }
    }
  };
  // Workers stop when the queue is momentarily empty, so keep relaunching until it stays empty.
  while (queue.length > 0) await Promise.all(Array.from({ length: 16 }, worker));
  onProgress?.(out.files.length);
  return out;
}

export { REBUILDABLE, rebuildableKind } from '@/lib/rebuildable';
