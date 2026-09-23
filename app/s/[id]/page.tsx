'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download, Eye, FolderDown, HardDrive, KeyRound, Link2Off, Loader2, Lock, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileIcon } from '@/components/nas/file-icon';
import { formatBytes, formatDate } from '@/components/nas/format';
import { PreviewDialog } from '@/components/nas/preview-dialog';
import { EncryptionSession } from '@/lib/client/crypto';
import {
  type FileEntry,
  type FileSource,
  NeedsPassphraseError,
  displayName,
  displaySize,
  downloadFile,
  downloadFolder,
  isEncrypted,
} from '@/lib/client/download';
import { previewKindOf } from '@/lib/file-types';

interface ShareInfo {
  name: string;
  type: 'file' | 'dir';
  expiresAt: string | null;
  needsPassword: boolean;
  sharedBy: string | null;
  files: FileEntry[] | null;
}

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [session, setSession] = useState<EncryptionSession | null>(null);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<FileEntry | null>(null);

  const source = useMemo<FileSource>(
    () => ({
      url: (path, inline) =>
        `/api/public/shares/${id}/download?path=${encodeURIComponent(path)}${inline ? '&inline=1' : ''}`,
    }),
    [id],
  );

  const load = useCallback(async () => {
    const res = await fetch(`/api/public/shares/${id}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? 'This link doesn’t work anymore.');
    setInfo(data);
  }, [id]);

  useEffect(() => {
    let canceled = false;
    fetch(`/api/public/shares/${id}`, { cache: 'no-store' })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (canceled) return;
        if (!ok) setError(data.error ?? 'This link doesn’t work anymore.');
        else setInfo(data);
      })
      .catch(() => !canceled && setError('Couldn’t reach the server. Check your connection and try again.'));
    return () => {
      canceled = true;
    };
  }, [id]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    setUnlockError('');
    const res = await fetch(`/api/public/shares/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setUnlocking(false);
    if (!res.ok) {
      setUnlockError((await res.json().catch(() => ({}))).error ?? 'Wrong password');
      return;
    }
    setPassword('');
    load();
  };

  const files = useMemo(() => (info?.files ?? []).filter((f) => f.type === 'file'), [info]);
  const hasEncrypted = files.some((f) => isEncrypted(f.path));
  const total = files.reduce((a, f) => a + displaySize(f), 0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files)
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
      .slice(0, 1000);
  }, [files, query]);

  const run = (action: () => Promise<unknown>) =>
    action().catch((err) => toast.error(err instanceof NeedsPassphraseError ? 'Enter the encryption passphrase first.' : err instanceof Error ? err.message : 'Download failed'));

  const downloadAll = () =>
    run(async () => {
      const toastId = toast.loading('Preparing download…');
      try {
        const result = await downloadFolder('', info?.files ?? [], session, (done, count) => toast.loading(`Saving ${done} of ${count} files`, { id: toastId }), source, info?.name);
        if (result === 'canceled') toast.dismiss(toastId);
        else toast.success(result === 'saved' ? `Saved “${info?.name}” with all its folders` : 'Downloaded', { id: toastId });
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    });

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_oklch(0.32_0.12_295)_0%,_transparent_60%)] px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-900">
            <HardDrive className="size-4 text-white" />
          </div>
          Shared with Local NAS
        </div>

        <section className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur sm:p-6">
          {error ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Link2Off className="mb-3 size-10 text-muted-foreground" />
              <p className="font-medium">{error}</p>
              <p className="mt-1 text-sm text-muted-foreground">Ask the person who sent it for a new link.</p>
            </div>
          ) : !info ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : info.needsPassword ? (
            <form onSubmit={unlock} className="mx-auto max-w-sm space-y-3 py-6 text-center">
              <Lock className="mx-auto size-8 text-primary" />
              <h1 className="text-lg font-semibold">“{info.name}” is password protected</h1>
              <Input type="password" autoFocus placeholder="Link password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
              {unlockError && <p className="text-sm text-destructive">{unlockError}</p>}
              <Button type="submit" className="w-full" disabled={!password || unlocking}>
                {unlocking && <Loader2 className="animate-spin" />} Open
              </Button>
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-start gap-3">
                <FileIcon name={info.name} isDir={info.type === 'dir'} className="mt-1 size-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-xl font-semibold">{info.type === 'file' ? displayName(info.name) : info.name}</h1>
                  <p className="text-sm text-muted-foreground">
                    {info.type === 'dir' ? `${files.length.toLocaleString()} files · ` : ''}
                    {formatBytes(total)}
                    {info.sharedBy && ` · shared by ${info.sharedBy}`}
                    {info.expiresAt && ` · link expires ${formatDate(info.expiresAt)}`}
                  </p>
                </div>
                {info.type === 'file' && files[0] ? (
                  <div className="flex gap-2">
                    {previewKindOf(displayName(files[0].path)) !== 'none' && (
                      <Button variant="outline" onClick={() => setPreview(files[0])}>
                        <Eye /> Preview
                      </Button>
                    )}
                    <Button onClick={() => run(() => downloadFile(files[0], session, source))}>
                      <Download /> Download
                    </Button>
                  </div>
                ) : (
                  <Button onClick={downloadAll} disabled={files.length === 0}>
                    <FolderDown /> Download all
                  </Button>
                )}
              </div>

              {hasEncrypted && (
                <form
                  className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (passphrase) setSession(new EncryptionSession(passphrase));
                  }}
                >
                  <KeyRound className="size-4 text-emerald-300" />
                  <span className="mr-auto text-sm">{session ? 'Encrypted files will be decrypted as they download.' : 'Some files are encrypted. Enter the passphrase you were given.'}</span>
                  {!session && (
                    <>
                      <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Passphrase" className="h-8 w-44" />
                      <Button type="submit" size="sm" disabled={!passphrase}>
                        Unlock
                      </Button>
                    </>
                  )}
                </form>
              )}

              {info.type === 'dir' && (
                <>
                  <div className="relative mt-5">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input type="search" placeholder="Search in this folder" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 pl-9" />
                  </div>
                  {shown.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">{files.length ? 'No files match your search.' : 'This folder is empty.'}</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-background/40">
                      {shown.map((f) => (
                        <li key={f.path} className="flex items-center gap-3 px-3 py-2">
                          <FileIcon name={displayName(f.path)} className="size-4 shrink-0" />
                          <button className="min-w-0 flex-1 text-left" onClick={() => previewKindOf(displayName(f.path)) !== 'none' && setPreview(f)} title={f.path}>
                            <span className="flex items-center gap-1.5 truncate text-sm">
                              <span className="truncate">{f.path.includes('/') ? `${f.path.slice(0, f.path.lastIndexOf('/') + 1)}${displayName(f.path)}` : displayName(f.path)}</span>
                              {isEncrypted(f.path) && <Lock className="size-3 shrink-0 text-emerald-300" />}
                            </span>
                            <span className="text-xs text-muted-foreground">{formatBytes(displaySize(f))}</span>
                          </button>
                          <Button size="icon-sm" variant="ghost" aria-label={`Download ${displayName(f.path)}`} onClick={() => run(() => downloadFile(f, session, source))}>
                            <Download />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {files.length > shown.length && !query && <p className="mt-2 text-xs text-muted-foreground">Showing the first 1,000 files. Use search or “Download all”.</p>}
                </>
              )}
            </>
          )}
        </section>
      </div>

      <PreviewDialog
        entry={preview}
        session={session}
        source={source}
        onClose={() => setPreview(null)}
        onDownload={(entry) => run(() => downloadFile(entry, session, source))}
        onUnlock={() => {
          setPreview(null);
          toast.info('Enter the encryption passphrase above.');
        }}
      />
    </div>
  );
}
