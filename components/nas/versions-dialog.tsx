'use client';

import { useEffect, useState } from 'react';
import { Download, History, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatBytes } from '@/components/nas/format';
import { type FileEntry, displayName, displaySize } from '@/lib/client/download';

interface Version {
  id: string;
  size: number;
  deletedAt: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function VersionsDialog({ entry, onClose, onRestored }: { entry: FileEntry | null; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let canceled = false;
    fetch(`/api/versions?path=${encodeURIComponent(entry.path)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => !canceled && setVersions(d.versions ?? []))
      .catch(() => !canceled && setVersions([]));
    return () => {
      canceled = true;
    };
  }, [entry]);

  const restore = async (v: Version) => {
    setBusy(v.id);
    const res = await fetch('/api/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id }) });
    setBusy(null);
    if (!res.ok) return toast.error('Couldn’t restore that version.');
    toast.success('Version restored. The one it replaced is kept in the history.');
    onRestored();
    onClose();
  };

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(o) => {
        if (!o) {
          setVersions(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate pr-8">
            <History className="size-5 shrink-0" /> <span className="truncate">{entry ? displayName(entry.path) : ''}</span>
          </DialogTitle>
          <DialogDescription>Earlier versions are kept for 30 days, up to 20 per file.</DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
            <span className="font-medium">Current version</span>
            <span className="text-muted-foreground"> · {formatBytes(displaySize(entry))} · {when(entry.modified)}</span>
          </div>
        )}
        {versions === null ? (
          <Loader2 className="mx-auto my-6 size-6 animate-spin text-muted-foreground" />
        ) : versions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No earlier versions yet. They appear when this file is replaced by an upload or backup.</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <p>Replaced {when(v.deletedAt)}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(v.size)}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label="Download this version" nativeButton={false} render={<a href={`/api/versions?download=${v.id}`} download />}>
                  <Download />
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => restore(v)}>
                  {busy === v.id ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
