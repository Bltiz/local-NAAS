'use client';

import { useMemo } from 'react';
import { ChevronRight, Download, Eye, FolderDown, History, Home, Link2, Lock, MoreVertical, RefreshCw, Search, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileIcon } from '@/components/nas/file-icon';
import { formatBytes, formatDate } from '@/components/nas/format';
import { type FileEntry, displayName, displaySize, isEncrypted } from '@/lib/client/download';
import { previewKindOf } from '@/lib/file-types';

const SEARCH_LIMIT = 500;

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

interface Props {
  entries: FileEntry[] | null;
  error: string | null;
  dir: string;
  query: string;
  onOpenDir: (path: string) => void;
  onRetry: () => void;
  onPreview: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onDownloadFolder: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onShare: (entry: FileEntry) => void;
  onVersions: (entry: FileEntry) => void;
}

export function FileBrowser({ entries, error, dir, query, onOpenDir, onRetry, onPreview, onDownload, onDownloadFolder, onDelete, onShare, onVersions }: Props) {
  const folderStats = useMemo(() => {
    const stats = new Map<string, { items: number; bytes: number }>();
    for (const e of entries ?? []) {
      const parent = parentOf(e.path);
      const direct = stats.get(parent) ?? { items: 0, bytes: 0 };
      direct.items++;
      stats.set(parent, direct);
      if (e.type === 'file') {
        const size = displaySize(e);
        for (let p = parent; p; p = parentOf(p)) {
          const s = stats.get(p) ?? { items: 0, bytes: 0 };
          s.bytes += size;
          stats.set(p, s);
        }
      }
    }
    return stats;
  }, [entries]);

  const trimmed = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!entries) return [];
    const list = trimmed
      ? entries.filter((e) => displayName(e.path).toLowerCase().includes(trimmed))
      : entries.filter((e) => parentOf(e.path) === dir);
    return list
      .sort((a, b) =>
        a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : displayName(a.path).localeCompare(displayName(b.path), undefined, { numeric: true }),
      )
      .slice(0, trimmed ? SEARCH_LIMIT : undefined);
  }, [entries, dir, trimmed]);

  const crumbs = dir ? dir.split('/') : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {trimmed ? (
        <div className="flex items-center gap-2 px-1 pb-3 text-sm text-muted-foreground">
          <Search className="size-4" />
          {rows.length === SEARCH_LIMIT ? `Showing the first ${SEARCH_LIMIT} matches` : `${rows.length} match${rows.length === 1 ? '' : 'es'}`} for
          <span className="font-medium text-foreground">“{query.trim()}”</span> across all folders
        </div>
      ) : (
        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-0.5 pb-3 text-sm">
          <button
            onClick={() => onOpenDir('')}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Home className="size-4" /> All files
          </button>
          {crumbs.map((name, i) => {
            const path = crumbs.slice(0, i + 1).join('/');
            const last = i === crumbs.length - 1;
            return (
              <span key={path} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                <button
                  onClick={() => onOpenDir(path)}
                  aria-current={last ? 'page' : undefined}
                  className={`max-w-[12rem] truncate rounded-md px-2 py-1 hover:bg-accent ${last ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {name}
                </button>
              </span>
            );
          })}
        </nav>
      )}

      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-10 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : entries === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          {trimmed ? (
            <>
              <Search className="mb-3 size-10 text-muted-foreground/50" />
              <p className="font-medium">No files match “{query.trim()}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Search looks at file and folder names in every folder.</p>
            </>
          ) : (
            <>
              <UploadCloud className="mb-3 size-10 text-muted-foreground/50" />
              <p className="font-medium">{dir ? 'This folder is empty' : 'No files yet'}</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Drag files or whole folders anywhere on this page, or use the Upload buttons above.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/40">
          {rows.map((entry) => {
            const name = displayName(entry.path);
            const isDir = entry.type === 'dir';
            const encrypted = isEncrypted(entry.path);
            const stats = folderStats.get(entry.path);
            const canPreview = !isDir && previewKindOf(name) !== 'none';
            const open = () => (isDir ? onOpenDir(entry.path) : onPreview(entry));
            return (
              <li key={entry.path} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 sm:px-4">
                <button onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left" title={entry.path}>
                  <FileIcon name={name} isDir={isDir} className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{name}</span>
                      {encrypted && <Lock className="size-3.5 shrink-0 text-emerald-300" aria-label="Encrypted" />}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {isDir
                        ? `${stats?.items ?? 0} item${stats?.items === 1 ? '' : 's'}${stats?.bytes ? ` · ${formatBytes(stats.bytes)}` : ''}`
                        : `${formatBytes(displaySize(entry))} · ${formatDate(entry.modified)}`}
                      {trimmed && parentOf(entry.path) && ` · in ${parentOf(entry.path)}`}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {!isDir && (
                    <Button variant="ghost" size="icon-sm" onClick={() => onDownload(entry)} aria-label={`Download ${name}`}>
                      <Download />
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`} />}>
                      <MoreVertical />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {isDir ? (
                        <DropdownMenuItem onClick={() => onDownloadFolder(entry)}>
                          <FolderDown /> Download folder
                        </DropdownMenuItem>
                      ) : (
                        <>
                          {canPreview && (
                            <DropdownMenuItem onClick={() => onPreview(entry)}>
                              <Eye /> Preview
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onDownload(entry)}>
                            <Download /> Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onVersions(entry)}>
                            <History /> Version history
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuItem onClick={() => onShare(entry)}>
                        <Link2 /> Share link…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(entry)}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
