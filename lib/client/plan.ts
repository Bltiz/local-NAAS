import { encryptedSize } from '@/lib/client/crypto';
import type { FileEntry } from '@/lib/client/download';
import { type Picked, rebuildableKind } from '@/lib/client/pick';
import { ENCRYPTED_SUFFIX, type PendingUpload } from '@/lib/client/upload';

export type PlanStatus = 'new' | 'changed' | 'check' | 'same';

export interface PlannedFile {
  file: File;
  path: string;
  status: PlanStatus;
  rebuild: string | null;
}

export interface RebuildGroup {
  name: string;
  files: number;
  bytes: number;
}

export interface UploadPlan {
  dest: string;
  files: PlannedFile[];
  emptyDirs: string[];
  rebuild: RebuildGroup[];
  encrypted: boolean;
}

const MAX_CHECK_BYTES = 64 * 1024 * 1024;
// Windows and some filesystems round modified times to 1-2 seconds.
const MTIME_TOLERANCE = 2000;

export function buildPlan(picked: Picked, dest: string, entries: FileEntry[], encrypted: boolean): UploadPlan {
  const existing = new Map(entries.map((e) => [e.path, e]));
  const join = (p: string) => (dest ? `${dest}/${p}` : p);
  const groups = new Map<string, RebuildGroup>();

  const files = picked.files.map(({ file, relPath }): PlannedFile => {
    const path = join(relPath);
    const rebuild = rebuildableKind(relPath);
    if (rebuild) {
      const g = groups.get(rebuild) ?? { name: rebuild, files: 0, bytes: 0 };
      g.files++;
      g.bytes += file.size;
      groups.set(rebuild, g);
    }
    const stored = existing.get(encrypted ? path + ENCRYPTED_SUFFIX : path);
    let status: PlanStatus = 'new';
    if (stored && stored.type === 'file') {
      const sameSize = stored.size === (encrypted ? encryptedSize(file.size) : file.size);
      const sameDate = Math.abs(new Date(stored.modified).getTime() - file.lastModified) < MTIME_TOLERANCE;
      if (sameSize && sameDate) status = 'same';
      else if (sameSize && !encrypted && file.size <= MAX_CHECK_BYTES) status = 'check';
      else status = 'changed';
    }
    return { file, path, status, rebuild };
  });

  return {
    dest,
    files,
    emptyDirs: picked.emptyDirs.map(join).filter((d) => !existing.has(d)),
    rebuild: Array.from(groups.values()).sort((a, b) => b.files - a.files),
    encrypted,
  };
}

export interface PlanTotals {
  newFiles: number;
  changedFiles: number;
  checkFiles: number;
  sameFiles: number;
  skippedFiles: number;
  uploadFiles: number;
  uploadBytes: number;
}

export function planTotals(plan: UploadPlan, skip: Set<string>): PlanTotals {
  const t: PlanTotals = { newFiles: 0, changedFiles: 0, checkFiles: 0, sameFiles: 0, skippedFiles: 0, uploadFiles: 0, uploadBytes: 0 };
  for (const f of plan.files) {
    if (f.rebuild && skip.has(f.rebuild)) {
      t.skippedFiles++;
      continue;
    }
    if (f.status === 'same') {
      t.sameFiles++;
      continue;
    }
    if (f.status === 'new') t.newFiles++;
    else if (f.status === 'changed') t.changedFiles++;
    else t.checkFiles++;
    t.uploadFiles++;
    t.uploadBytes += plan.encrypted ? encryptedSize(f.file.size) : f.file.size;
  }
  return t;
}

export function planUploads(plan: UploadPlan, skip: Set<string>): { uploads: PendingUpload[]; dirs: string[] } {
  const uploads: PendingUpload[] = [];
  for (const f of plan.files) {
    if (f.status === 'same' || (f.rebuild && skip.has(f.rebuild))) continue;
    uploads.push({ file: f.file, path: f.path, verify: f.status === 'check' });
  }
  const dirs = plan.emptyDirs.filter((d) => {
    const kind = rebuildableKind(`${d}/x`);
    return !kind || !skip.has(kind);
  });
  return { uploads, dirs };
}
