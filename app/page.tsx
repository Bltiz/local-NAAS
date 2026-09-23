'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FolderPlus, FolderUp, HardDrive, Lock, LockOpen, LogOut, RefreshCw, Search, Trash2, Upload, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DevicesPanel } from '@/components/nas/devices-panel';
import { EncryptionDialog } from '@/components/nas/encryption-dialog';
import { FileBrowser } from '@/components/nas/file-browser';
import { formatBytes } from '@/components/nas/format';
import { PlanDialog, type SpeedHistory } from '@/components/nas/plan-dialog';
import { PreviewDialog } from '@/components/nas/preview-dialog';
import { StoragePanel, type StorageInfo } from '@/components/nas/storage-panel';
import { TrashDialog } from '@/components/nas/trash-dialog';
import { UploadPanel } from '@/components/nas/upload-panel';
import { EncryptionSession } from '@/lib/client/crypto';
import {
  type FileEntry,
  NeedsPassphraseError,
  displayName,
  downloadFile,
  downloadFolder,
  supportsFolderSave,
} from '@/lib/client/download';
import { type Picked, entriesFromDrop, fromEntries, fromFileList } from '@/lib/client/pick';
import { type UploadPlan, buildPlan, planUploads } from '@/lib/client/plan';
import { type DirectSnapshot, DirectShare, type Peer, defaultDeviceName } from '@/lib/client/rtc';
import { type SavedFile, Uploader } from '@/lib/client/upload';

const DEVICE_NAME_KEY = 'nas-device-name';
const SPEED_KEY = 'nas-upload-speed';
const EMPTY_DIRECT: DirectSnapshot = { selfId: '', selfName: '', online: false, peers: [], transfers: [] };
const noopSubscribe = () => () => {};

function signOutRedirect() {
  window.location.replace('/login');
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function mergeSaved(prev: FileEntry[] | null, saved: SavedFile[]): FileEntry[] | null {
  if (!prev) return prev;
  const map = new Map(prev.map((e) => [e.path, e]));
  for (const f of saved) {
    map.set(f.path, { path: f.path, type: 'file', size: f.size, modified: f.modified });
    for (let p = parentOf(f.path); p && !map.has(p); p = parentOf(p)) map.set(p, { path: p, type: 'dir', size: 0, modified: f.modified });
  }
  return Array.from(map.values());
}

interface ListResponse {
  entries: FileEntry[];
  usage: { free: number; total: number } | null;
  trashBytes: number;
  storage: StorageInfo;
}

export default function Home() {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [usage, setUsage] = useState<{ free: number; total: number } | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [trashBytes, setTrashBytes] = useState(0);
  const [trashOpen, setTrashOpen] = useState(false);
  const [scanning, setScanning] = useState<number | null>(null);
  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [planTarget, setPlanTarget] = useState<Peer | null>(null);
  const [speed, setSpeed] = useState<SpeedHistory | null>(null);
  const savedBuffer = useRef<SavedFile[]>([]);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dir, setDir] = useState('');
  const [query, setQuery] = useState('');
  const [session, setSession] = useState<EncryptionSession | null>(null);
  const [encryptUploads, setEncryptUploads] = useState(false);
  const [encOpen, setEncOpen] = useState(false);
  const pendingUnlock = useRef<((s: EncryptionSession) => void) | null>(null);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [direct, setDirect] = useState<DirectShare | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEntries = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/files${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (res.status === 401) return signOutRedirect();
      if (!res.ok) throw new Error(`The server returned an error (${res.status}).`);
      const data = (await res.json()) as ListResponse;
      setEntries(data.entries);
      setUsage(data.usage);
      setStorage(data.storage);
      setTrashBytes(data.trashBytes);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load your files.');
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      loadEntries();
    }, 400);
  }, [loadEntries]);

  // Uploaded files are merged into the list locally (at most once a second)
  // instead of re-fetching a listing that may hold 100k+ entries.
  const onSaved = useCallback((files: SavedFile[]) => {
    savedBuffer.current.push(...files);
    if (savedTimer.current) return;
    savedTimer.current = setTimeout(() => {
      savedTimer.current = null;
      const batch = savedBuffer.current.splice(0);
      setEntries((prev) => mergeSaved(prev, batch));
    }, 1000);
  }, []);

  const [uploader] = useState(() => new Uploader());
  useEffect(() => {
    uploader.setCallbacks({ onSaved, onSignedOut: signOutRedirect });
  }, [uploader, onSaved]);
  const uploads = useSyncExternalStore(uploader.subscribe, uploader.getSnapshot, uploader.getSnapshot);
  const directSnapshot = useSyncExternalStore(
    direct?.subscribe ?? noopSubscribe,
    () => direct?.getSnapshot() ?? EMPTY_DIRECT,
    () => EMPTY_DIRECT,
  );

  useEffect(() => {
    fetch('/api/files', { cache: 'no-store' })
      .then((res) => {
        if (res.status === 401) {
          signOutRedirect();
          return null;
        }
        if (!res.ok) throw new Error(`The server returned an error (${res.status}).`);
        return res.json();
      })
      .then((data: ListResponse | null) => {
        if (!data) return;
        setEntries(data.entries);
        setUsage(data.usage);
        setStorage(data.storage);
        setTrashBytes(data.trashBytes);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'Could not load your files.'));
    fetch('/api/auth-status')
      .then((res) => res.json())
      .then((data) => setPasswordProtected(data.mode === 'protected'))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const share = new DirectShare(localStorage.getItem(DEVICE_NAME_KEY) || defaultDeviceName());
    share.connect();
    const frame = requestAnimationFrame(() => setDirect(share));
    return () => {
      cancelAnimationFrame(frame);
      share.dispose();
    };
  }, []);

  const uploading = uploads.running;
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(SPEED_KEY) ?? 'null');
        if (saved) setSpeed(saved);
      } catch {}
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Remember the average speed of each finished upload for the next time estimate.
  const run = useRef<{ t: number; bytes: number; files: number } | null>(null);
  useEffect(() => {
    if (uploading && !run.current) {
      run.current = { t: performance.now(), bytes: uploads.sentBytes, files: uploads.doneFiles };
    } else if (!uploading && run.current) {
      const secs = (performance.now() - run.current.t) / 1000;
      const bytes = uploads.sentBytes - run.current.bytes;
      const files = uploads.doneFiles - run.current.files;
      run.current = null;
      if (secs > 3 && files > 0) {
        const next = { bytesPerSecond: bytes / secs, filesPerSecond: files / secs };
        localStorage.setItem(SPEED_KEY, JSON.stringify(next));
        requestAnimationFrame(() => setSpeed(next));
      }
    }
  }, [uploading, uploads.sentBytes, uploads.doneFiles]);

  const withUnlock = (action: (s: EncryptionSession | null) => Promise<unknown>) => {
    action(session).catch((error) => {
      if (error instanceof NeedsPassphraseError) {
        pendingUnlock.current = (s) => action(s).catch((e) => toast.error(e instanceof Error ? e.message : 'Something went wrong'));
        setEncOpen(true);
      } else {
        toast.error(error instanceof Error ? error.message : 'Something went wrong');
      }
    });
  };

  const showPlan = (picked: Picked, target: Peer | null = null) => {
    setScanning(null);
    if (picked.files.length === 0 && picked.emptyDirs.length === 0) return;
    setPlanTarget(target);
    setPlan(buildPlan(picked, target ? '' : dir, target ? [] : (entries ?? []), !target && encryptUploads && session !== null));
  };

  const scanDrop = (dropped: FileSystemEntry[], target: Peer | null) => {
    setScanning(0);
    fromEntries(dropped, setScanning)
      .then((picked) => showPlan(picked, target))
      .catch(() => {
        setScanning(null);
        toast.error('Could not read the dropped files.');
      });
  };

  const confirmPlan = async (skip: Set<string>) => {
    const current = plan;
    const target = planTarget;
    setPlan(null);
    setPlanTarget(null);
    if (!current) return;
    const { uploads: pending, dirs } = planUploads(current, skip);
    if (target) {
      direct?.send(target, pending.map((u) => ({ file: u.file, path: u.path })));
      return;
    }
    for (const path of dirs) {
      await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    }
    if (pending.length) uploader.add(pending, current.encrypted ? session : null);
    if (dirs.length) scheduleRefresh();
  };

  const startUpload = (picked: Picked) => showPlan(picked);

  const onPickedInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) startUpload(fromFileList(e.target.files));
    e.target.value = '';
  };

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const dropped = entriesFromDrop(e.dataTransfer);
    if (dropped) scanDrop(dropped, null);
    else startUpload(fromFileList(e.dataTransfer.files));
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const res = await fetch(`/api/files?path=${encodeURIComponent(target.path)}`, { method: 'DELETE' });
    if (res.status === 401) return signOutRedirect();
    if (!res.ok) toast.error(`Couldn’t delete ${displayName(target.path)}.`);
    else {
      const { trashId } = await res.json();
      toast.success(`Moved ${displayName(target.path)} to Trash`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            const undo = await fetch('/api/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: trashId }) });
            if (!undo.ok) toast.error('Couldn’t restore it. Open Trash to try again.');
            loadEntries(true);
          },
        },
      });
      if (target.type === 'dir' && (dir === target.path || dir.startsWith(`${target.path}/`))) setDir(target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : '');
    }
    loadEntries();
  };

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name || name.includes('/')) return;
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir ? `${dir}/${name}` : name }),
    });
    if (!res.ok) toast.error('Couldn’t create that folder.');
    setNewFolderOpen(false);
    setNewFolderName('');
    loadEntries();
  };

  const onDownloadFolder = (entry: FileEntry) =>
    withUnlock(async (s) => {
      const id = toast.loading(`Preparing ${displayName(entry.path)}…`);
      try {
        const result = await downloadFolder(entry.path, entries ?? [], s, (done, total) =>
          toast.loading(`Saving ${displayName(entry.path)}: ${done} of ${total} files`, { id }),
        );
        if (result === 'canceled') toast.dismiss(id);
        else toast.success(result === 'saved' ? `Saved ${displayName(entry.path)} with all its folders` : `Downloaded ${displayName(entry.path)}`, { id });
      } catch (error) {
        toast.dismiss(id);
        throw error;
      }
    });

  const sendDirect = (peer: Peer, picked: Picked) => {
    if (!direct || picked.files.length === 0) return;
    showPlan(picked, peer);
  };

  const usedPercent = usage ? Math.round(((usage.total - usage.free) / usage.total) * 100) : null;

  return (
    <div
      className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_oklch(0.32_0.12_295)_0%,_transparent_60%)]"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current++;
        setDragActive(true);
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={onDrop}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-background/70 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-900">
              <HardDrive className="size-5 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="font-semibold">Local NAS</h1>
              {usage && (
                <p className="text-[11px] text-muted-foreground">
                  {formatBytes(usage.free)} free{usedPercent !== null ? ` · ${usedPercent}% used` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="relative order-last w-full sm:order-none sm:ml-4 sm:max-w-md sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search all files and folders"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pr-8 pl-9"
              aria-label="Search files"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEncOpen(true)} className={session ? 'border-emerald-400/40 text-emerald-200' : ''}>
              {session ? <LockOpen /> : <Lock />}
              <span className="hidden sm:inline">{session ? (encryptUploads ? 'Encrypting uploads' : 'Unlocked') : 'Encryption'}</span>
            </Button>
            {passwordProtected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await fetch('/api/logout', { method: 'POST' });
                  signOutRedirect();
                }}
              >
                <LogOut /> <span className="hidden sm:inline">Sign out</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Cloud files" className="flex min-w-0 flex-col rounded-2xl border border-border bg-card/60 p-4 backdrop-blur sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto flex items-center gap-2 font-semibold">
              <UploadCloud className="size-4 text-violet-300" /> Cloud files
              {encryptUploads && session && (
                <Badge variant="secondary" className="gap-1 text-emerald-200">
                  <Lock className="size-3" /> Encrypted uploads
                </Badge>
              )}
            </h2>
            <Button size="sm" onClick={() => filesInput.current?.click()}>
              <Upload /> Upload files
            </Button>
            <Button size="sm" variant="outline" onClick={() => folderInput.current?.click()}>
              <FolderUp /> Upload folder
            </Button>
            <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)} aria-label="New folder">
              <FolderPlus /> <span className="hidden sm:inline">New folder</span>
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setTrashOpen(true)} aria-label="Open trash">
              <Trash2 />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => loadEntries(true)} aria-label="Refresh">
              <RefreshCw />
            </Button>
          </div>
          <FileBrowser
            entries={entries}
            error={loadError}
            dir={dir}
            query={query}
            onOpenDir={(path) => {
              setDir(path);
              setQuery('');
            }}
            onRetry={() => loadEntries(true)}
            onPreview={setPreview}
            onDownload={(entry) => withUnlock((s) => downloadFile(entry, s))}
            onDownloadFolder={onDownloadFolder}
            onDelete={setDeleteTarget}
          />
          {!supportsFolderSave() && entries?.some((e) => e.type === 'dir') && (
            <p className="mt-3 text-xs text-muted-foreground">
              Tip: in Chrome or Edge on a computer, “Download folder” saves the whole folder structure. Other browsers download files one by one.
            </p>
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-6">
          <DevicesPanel
            snapshot={directSnapshot}
            onSend={sendDirect}
            onSendEntries={(peer, dropped) => scanDrop(dropped, peer)}
            onAccept={(id) => direct?.accept(id)}
            onDecline={(id) => direct?.decline(id)}
            onCancel={(id) => direct?.cancel(id)}
            onDismiss={(id) => direct?.dismiss(id)}
            onRename={(name) => {
              localStorage.setItem(DEVICE_NAME_KEY, name);
              direct?.rename(name);
            }}
          />
          <UploadPanel
            snapshot={uploads}
            onRetry={() => uploader.retryFailed()}
            onCancel={() => uploader.cancelAll()}
            onClear={() => uploader.clearFinished()}
          />
          <StoragePanel
            entries={entries}
            usage={usage}
            trashBytes={trashBytes}
            storage={storage}
            onOpenTrash={() => setTrashOpen(true)}
            onOpenFolder={(path) => {
              setDir(path);
              setQuery('');
            }}
          />
        </aside>
      </main>

      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="rounded-3xl border-2 border-dashed border-primary bg-card/80 px-10 py-12 text-center shadow-2xl">
            <UploadCloud className="mx-auto mb-3 size-12 text-primary" />
            <p className="text-lg font-semibold">Drop to upload to {dir ? `“${displayName(dir)}”` : 'All files'}</p>
            <p className="mt-1 text-sm text-muted-foreground">Folders keep their full structure{encryptUploads && session ? ' · files will be encrypted' : ''}</p>
          </div>
        </div>
      )}

      <input ref={filesInput} type="file" multiple hidden onChange={onPickedInput} />
      <input ref={folderInput} type="file" hidden onChange={onPickedInput} {...{ webkitdirectory: '', directory: '' }} />

      <PlanDialog
        scanning={scanning}
        plan={plan}
        freeBytes={usage?.free ?? null}
        speed={speed}
        sendTo={planTarget?.name ?? null}
        onConfirm={confirmPlan}
        onCancel={() => {
          setPlan(null);
          setPlanTarget(null);
          setScanning(null);
        }}
      />

      <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onChanged={() => loadEntries(true)} />

      <PreviewDialog
        entry={preview}
        session={session}
        onClose={() => setPreview(null)}
        onDownload={(entry) => withUnlock((s) => downloadFile(entry, s))}
        onUnlock={() => setEncOpen(true)}
      />

      <EncryptionDialog
        open={encOpen}
        onOpenChange={(open) => {
          setEncOpen(open);
          if (!open) pendingUnlock.current = null;
        }}
        unlocked={session !== null}
        encryptUploads={encryptUploads}
        onEncryptUploadsChange={setEncryptUploads}
        onUnlock={(passphrase, encryptNew) => {
          const s = new EncryptionSession(passphrase);
          setSession(s);
          setEncryptUploads(encryptNew);
          setEncOpen(false);
          toast.success(encryptNew ? 'New uploads will be encrypted' : 'Encrypted files unlocked');
          pendingUnlock.current?.(s);
          pendingUnlock.current = null;
        }}
        onLock={() => {
          setSession(null);
          setEncryptUploads(false);
        }}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget ? `“${displayName(deleteTarget.path)}”` : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'dir' ? 'The folder and everything inside it move to Trash.' : 'The file moves to Trash.'} You can
              restore it from Trash for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder{dir ? ` in “${displayName(dir)}”` : ''}</DialogTitle>
          </DialogHeader>
          <form onSubmit={createFolder} className="space-y-4">
            <Input
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              aria-invalid={newFolderName.includes('/')}
              className="h-10"
            />
            {newFolderName.includes('/') && <p className="text-xs text-destructive">Folder names can’t contain “/”.</p>}
            <DialogFooter>
              <Button type="submit" disabled={!newFolderName.trim() || newFolderName.includes('/')}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
