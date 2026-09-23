'use client';

import { useMemo } from 'react';
import { AlertTriangle, Database, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/components/nas/format';
import { type FileEntry, displaySize } from '@/lib/client/download';

export interface StorageInfo {
  mode: 'server' | 'local';
  name: string;
  location: string;
  persistent: boolean | null;
}

interface Props {
  entries: FileEntry[] | null;
  usage: { free: number; total: number } | null;
  trashBytes: number;
  storage: StorageInfo | null;
  onOpenTrash: () => void;
  onOpenFolder: (path: string) => void;
}

export function StoragePanel({ entries, usage, trashBytes, storage, onOpenTrash, onOpenFolder }: Props) {
  const { filesBytes, fileCount, top } = useMemo(() => {
    const byTop = new Map<string, { bytes: number; files: number; isDir: boolean }>();
    let filesBytes = 0;
    let fileCount = 0;
    for (const e of entries ?? []) {
      const top = e.path.split('/')[0];
      const t = byTop.get(top) ?? { bytes: 0, files: 0, isDir: e.path.includes('/') || e.type === 'dir' };
      if (e.type === 'file') {
        const size = displaySize(e);
        t.bytes += size;
        t.files++;
        filesBytes += size;
        fileCount++;
      }
      if (e.path.includes('/')) t.isDir = true;
      byTop.set(top, t);
    }
    const top = Array.from(byTop.entries())
      .filter(([, v]) => v.isDir)
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 6);
    return { filesBytes, fileCount, top };
  }, [entries]);

  const used = usage ? usage.total - usage.free : 0;
  const percent = usage && usage.total ? (used / usage.total) * 100 : 0;

  return (
    <section aria-labelledby="storage-title" className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur sm:p-5">
      <h2 id="storage-title" className="flex items-center gap-2 font-semibold">
        <Database className="size-4 text-sky-300" /> Storage
      </h2>
      {storage && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={storage.location}>{storage.location}</p>}

      {storage?.persistent === false && (
        <p className="mt-3 flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          No Railway volume is attached, so files are wiped on every restart. Attach a volume to this service.
        </p>
      )}

      {usage && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>
              {formatBytes(used)} of {formatBytes(usage.total)} used
            </span>
            <span>{formatBytes(usage.free)} free</span>
          </div>
          <Progress value={percent} className="mt-1.5 h-2" />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-background/40 p-2.5">
          <dt className="text-xs text-muted-foreground">Your files</dt>
          <dd className="font-semibold tabular-nums">{formatBytes(filesBytes)}</dd>
          <dd className="text-xs text-muted-foreground tabular-nums">{fileCount.toLocaleString()} files</dd>
        </div>
        <button onClick={onOpenTrash} className="rounded-lg bg-background/40 p-2.5 text-left hover:bg-accent/50">
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <Trash2 className="size-3" /> Trash
          </dt>
          <dd className="font-semibold tabular-nums">{formatBytes(trashBytes)}</dd>
          <dd className="text-xs text-muted-foreground">Open trash</dd>
        </button>
      </dl>
      {usage && used > filesBytes + trashBytes * 1.05 + 50 * 1024 * 1024 && (
        <p className="mt-2 text-xs text-muted-foreground">
          The rest of the used space ({formatBytes(Math.max(0, used - filesBytes - trashBytes))}) belongs to the disk itself or other data, not
          your files.
        </p>
      )}

      {top.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {top.map(([name, v]) => (
            <li key={name}>
              <Button variant="ghost" className="h-auto w-full justify-between px-2 py-1.5 text-sm" onClick={() => onOpenFolder(name)}>
                <span className="truncate">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatBytes(v.bytes)} · {v.files.toLocaleString()} files
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
