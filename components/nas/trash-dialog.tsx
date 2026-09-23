'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileIcon } from '@/components/nas/file-icon';
import { formatBytes, formatDate } from '@/components/nas/format';
import { displayName } from '@/lib/client/download';

interface TrashItem {
  id: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  deletedAt: string;
  reason: 'deleted' | 'replaced';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function TrashDialog({ open, onOpenChange, onChanged }: Props) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [keepDays, setKeepDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/trash', { cache: 'no-store' });
    if (!res.ok) {
      toast.error('Couldn’t load the trash.');
      return;
    }
    const data = await res.json();
    setItems(data.items);
    setKeepDays(data.keepDays);
  }, []);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    fetch('/api/trash', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (canceled) return;
        setItems(data.items);
        setKeepDays(data.keepDays);
      })
      .catch(() => !canceled && toast.error('Couldn’t load the trash.'));
    return () => {
      canceled = true;
    };
  }, [open]);

  const restore = async (item: TrashItem) => {
    setBusy(item.id);
    const res = await fetch('/api/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) });
    setBusy(null);
    if (!res.ok) return toast.error(`Couldn’t restore ${displayName(item.path)}.`);
    const { restoredTo } = await res.json();
    toast.success(restoredTo === item.path ? `Restored ${displayName(item.path)}` : `Restored as ${restoredTo}`);
    load();
    onChanged();
  };

  const remove = async (id: string | 'all') => {
    setBusy(id);
    const res = await fetch(`/api/trash?${id === 'all' ? 'all=1' : `id=${id}`}`, { method: 'DELETE' });
    setBusy(null);
    setConfirmEmpty(false);
    if (!res.ok) return toast.error('Couldn’t delete from trash.');
    load();
    onChanged();
  };

  const total = (items ?? []).reduce((a, i) => a + i.size, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setConfirmEmpty(false);
        onOpenChange(o);
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5" /> Trash
          </DialogTitle>
          <DialogDescription>
            Deleted files and old versions of replaced files are kept for {keepDays} days, then removed for good.
            {items && items.length > 0 && ` Using ${formatBytes(total)}.`}
          </DialogDescription>
        </DialogHeader>

        {items === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Trash is empty.</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                <FileIcon name={displayName(item.path)} isDir={item.type === 'dir'} className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={item.path}>
                    {displayName(item.path)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.reason === 'replaced' ? 'Old version' : 'Deleted'} {formatDate(item.deletedAt)} · {formatBytes(item.size)}
                    {item.path.includes('/') && ` · from ${item.path.slice(0, item.path.lastIndexOf('/'))}`}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => restore(item)}>
                  {busy === item.id ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restore
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={busy !== null} onClick={() => remove(item.id)} aria-label="Delete forever">
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {items && items.length > 0 && (
          <div className="flex justify-end gap-2">
            {confirmEmpty ? (
              <>
                <span className="self-center text-sm text-muted-foreground">Delete all {items.length} items forever?</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmEmpty(false)}>
                  Keep
                </Button>
                <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => remove('all')}>
                  Empty trash
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmEmpty(true)}>
                Empty trash
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
