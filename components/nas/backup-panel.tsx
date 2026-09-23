'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudUpload, Loader2, PauseCircle, RefreshCw, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/components/nas/format';
import { formatAgo } from '@/components/nas/location-switcher';

interface SyncResponse {
  config: {
    serverUrl: string | null;
    folder: string;
    enabled: boolean;
    skipRebuildable: boolean;
    mirrorDeletes: boolean;
    lastSyncAt: string | null;
    connected: boolean;
  };
  status: {
    state: 'not-connected' | 'paused' | 'idle' | 'scanning' | 'syncing' | 'offline' | 'signed-out' | 'error';
    lastSyncAt: string | null;
    lastError: string | null;
    totalFiles: number;
    doneFiles: number;
    failedFiles: number;
    totalBytes: number;
    doneBytes: number;
    deleted: number;
    unchanged: number;
    current: string | null;
  };
}

async function post(body: Record<string, unknown>): Promise<SyncResponse> {
  const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data;
}

export function BackupPanel({ defaultFolder }: { defaultFolder: string }) {
  const [data, setData] = useState<SyncResponse | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [password, setPassword] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const refresh = useCallback(async () => {
    const res = await fetch('/api/sync', { cache: 'no-store' });
    if (res.ok) setData(await res.json());
  }, []);

  const active = data?.status.state === 'scanning' || data?.status.state === 'syncing';
  useEffect(() => {
    let canceled = false;
    const tick = async () => {
      const res = await fetch('/api/sync', { cache: 'no-store' }).catch(() => null);
      if (!canceled && res?.ok) setData(await res.json());
    };
    tick();
    const timer = setInterval(tick, active ? 1500 : 15000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [active]);

  if (!data) return null;
  const { config, status } = data;
  const showForm = !config.connected;

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      setData(await post({ action: 'connect', serverUrl: serverUrl || config.serverUrl, password, folder: folder || config.folder || defaultFolder }));
      setPassword('');
      toast.success('Connected. Your first backup is starting.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Couldn’t connect');
    } finally {
      setBusy(false);
    }
  };

  const update = async (patch: Record<string, unknown>) => {
    try {
      setData(await post({ action: 'update', ...patch }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t save');
    }
  };

  const percent = status.totalBytes ? (status.doneBytes / status.totalBytes) * 100 : status.totalFiles ? (status.doneFiles / status.totalFiles) * 100 : 0;

  return (
    <section aria-labelledby="backup-title" className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur sm:p-5">
      <h2 id="backup-title" className="flex items-center gap-2 font-semibold">
        <CloudUpload className="size-4 text-sky-300" /> Backup to server
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Keeps a copy of this PC’s shared folder on your Railway NAS. Only new and changed files are sent, and nothing on this PC is ever
        deleted.
      </p>

      {showForm ? (
        <form onSubmit={connect} className="mt-4 space-y-3">
          {status.state === 'signed-out' && (
            <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              <AlertTriangle className="size-4 shrink-0 text-amber-300" /> The server password changed. Enter it again to keep backing up.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="sync-url">Server address</Label>
            <Input
              id="sync-url"
              placeholder="https://your-app.up.railway.app"
              value={serverUrl || config.serverUrl || ''}
              onChange={(e) => setServerUrl(e.target.value)}
              className="h-9"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sync-pass">Server password</Label>
            <Input id="sync-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-9" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sync-folder">Folder on the server</Label>
            <Input id="sync-folder" value={folder || config.folder || defaultFolder} onChange={(e) => setFolder(e.target.value)} className="h-9" />
          </div>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Loader2 className="animate-spin" />} Connect and back up
          </Button>
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-background/40 p-3 text-sm">
            {active ? (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <Loader2 className="size-4 animate-spin text-sky-300" />
                  {status.state === 'scanning' ? 'Checking for changes…' : `Backing up ${status.doneFiles.toLocaleString()} of ${status.totalFiles.toLocaleString()} files`}
                </p>
                {status.state === 'syncing' && (
                  <>
                    <Progress value={percent} className="mt-2 h-1.5" />
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {formatBytes(status.doneBytes)} of {formatBytes(status.totalBytes)}
                      {status.current && ` · ${status.current}`}
                    </p>
                  </>
                )}
              </>
            ) : status.state === 'paused' ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <PauseCircle className="size-4" /> Automatic backup is paused
              </p>
            ) : status.state === 'offline' ? (
              <p className="flex items-center gap-2 text-amber-200">
                <WifiOff className="size-4" /> Can’t reach the server. Retrying automatically.
              </p>
            ) : status.state === 'error' ? (
              <p className="flex gap-2 text-destructive">
                <AlertTriangle className="size-4 shrink-0" /> {status.lastError}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="size-4" /> Backed up {formatAgo(status.lastSyncAt)}
              </p>
            )}
            {!active && status.state === 'idle' && (status.totalFiles > 0 || status.deleted > 0) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Last run: {status.doneFiles.toLocaleString()} sent
                {status.deleted > 0 && `, ${status.deleted.toLocaleString()} removed (in server Trash)`}
                {status.failedFiles > 0 && `, ${status.failedFiles.toLocaleString()} failed`}
              </p>
            )}
            {!active && status.state === 'idle' && status.lastError && <p className="mt-1 text-xs text-amber-200">{status.lastError}</p>}
          </div>

          <p className="truncate text-xs text-muted-foreground" title={`${config.serverUrl}/${config.folder}`}>
            To <span className="text-foreground">{config.folder}</span> on {config.serverUrl?.replace(/^https?:\/\//, '')}
          </p>

          <div className="space-y-2 text-sm">
            <label className="flex items-center justify-between gap-3">
              <span>Back up automatically</span>
              <Switch checked={config.enabled} onCheckedChange={(v) => update({ enabled: v })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                Skip rebuildable folders
                <span className="block text-xs text-muted-foreground">node_modules, .next, dist, venv…</span>
              </span>
              <Switch checked={config.skipRebuildable} onCheckedChange={(v) => update({ skipRebuildable: v })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                Mirror deletions
                <span className="block text-xs text-muted-foreground">Files deleted here go to the server’s Trash</span>
              </span>
              <Switch checked={config.mirrorDeletes} onCheckedChange={(v) => update({ mirrorDeletes: v })} />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={active} onClick={() => post({ action: 'run' }).then(setData).then(() => setTimeout(refresh, 800))}>
              <RefreshCw /> Back up now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                setData(await post({ action: 'disconnect' }));
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
