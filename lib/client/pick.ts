export interface PickedFile {
  file: File;
  relPath: string;
}

export interface Picked {
  files: PickedFile[];
  emptyDirs: string[];
}

export function fromFileList(list: FileList): Picked {
  return {
    files: Array.from(list, (file) => ({ file, relPath: file.webkitRelativePath || file.name })),
    emptyDirs: [],
  };
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries returns results in batches (~100 in Chrome) until it returns an empty batch.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: FileSystemEntry, prefix: string, out: Picked) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    out.files.push({ file: await entryFile(entry as FileSystemFileEntry), relPath: path });
  } else if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    if (children.length === 0) out.emptyDirs.push(path);
    for (const child of children) await walk(child, path, out);
  }
}

// Entries must be grabbed synchronously inside the drop handler, before any await.
export function entriesFromDrop(dt: DataTransfer): FileSystemEntry[] | null {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  if (items.length === 0 || typeof items[0].webkitGetAsEntry !== 'function') return null;
  return items.map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => e !== null);
}

export async function fromEntries(entries: FileSystemEntry[]): Promise<Picked> {
  const out: Picked = { files: [], emptyDirs: [] };
  for (const entry of entries) await walk(entry, '', out);
  return out;
}

// Maps picked paths into destDir. A top-level folder that already exists gets a
// "Name (1)" suffix so an upload never merges into or overwrites existing files.
export function placeInto(picked: Picked, destDir: string, existing: Set<string>): { files: { file: File; path: string }[]; dirs: string[] } {
  const join = (p: string) => (destDir ? `${destDir}/${p}` : p);
  const renamed = new Map<string, string>();
  const topName = (rel: string) => rel.split('/')[0];
  const isFolderTop = (rel: string) => rel.includes('/');

  const tops = new Set<string>([
    ...picked.files.filter((f) => isFolderTop(f.relPath)).map((f) => topName(f.relPath)),
    ...picked.emptyDirs.map(topName),
  ]);
  for (const top of tops) {
    let candidate = top;
    for (let i = 1; existing.has(join(candidate)); i++) candidate = `${top} (${i})`;
    renamed.set(top, candidate);
  }
  const remap = (rel: string) => {
    const [top, ...rest] = rel.split('/');
    const mapped = renamed.get(top);
    return join(mapped && (rest.length > 0 || picked.emptyDirs.includes(rel)) ? [mapped, ...rest].join('/') : rel);
  };

  return {
    files: picked.files.map((f) => ({ file: f.file, path: remap(f.relPath) })),
    dirs: picked.emptyDirs.map(remap),
  };
}
