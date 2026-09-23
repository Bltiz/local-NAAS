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

  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { entry, prefix } = job;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile) {
        out.files.push({ file: await entryFile(entry as FileSystemFileEntry), relPath: path });
        if (onProgress && out.files.length - lastReport >= 250) {
          lastReport = out.files.length;
          onProgress(out.files.length);
        }
      } else if (entry.isDirectory) {
        const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
        if (children.length === 0) out.emptyDirs.push(path);
        for (const child of children) queue.push({ entry: child, prefix: path });
      }
    }
  };
  // Workers stop when the queue is momentarily empty, so keep relaunching until it stays empty.
  while (queue.length > 0) await Promise.all(Array.from({ length: 16 }, worker));
  onProgress?.(out.files.length);
  return out;
}

// Folders that tools recreate on demand. Shown in the upload summary so they can be skipped.
export const REBUILDABLE = new Map<string, string>([
  ['node_modules', 'npm install'],
  ['.next', 'next build'],
  ['.nuxt', 'nuxt build'],
  ['.svelte-kit', 'svelte-kit sync'],
  ['.turbo', 'turbo cache'],
  ['.parcel-cache', 'parcel cache'],
  ['.vite', 'vite cache'],
  ['.cache', 'tool cache'],
  ['dist', 'build output'],
  ['build', 'build output'],
  ['coverage', 'test coverage'],
  ['__pycache__', 'Python cache'],
  ['.pytest_cache', 'pytest cache'],
  ['.mypy_cache', 'mypy cache'],
  ['.venv', 'Python virtualenv'],
  ['venv', 'Python virtualenv'],
  ['target', 'Rust/Java build output'],
  ['.gradle', 'Gradle cache'],
  ['Pods', 'pod install'],
  ['DerivedData', 'Xcode build'],
]);

export function rebuildableKind(relPath: string): string | null {
  const segments = relPath.split('/');
  for (let i = 0; i < segments.length - 1; i++) if (REBUILDABLE.has(segments[i])) return segments[i];
  return null;
}
