'use client';

import { CheckCircle2, Loader2, Lock, RotateCcw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatEta, formatSpeed } from '@/components/nas/format';
import type { UploadSnapshot } from '@/lib/client/upload';

const VISIBLE_ROWS = 60;

interface Props {
  snapshot: UploadSnapshot;
  onRetry: () => void;
  onCancel: () => void;
  onClear: () => void;
}

export function UploadPanel({ snapshot, onRetry, onCancel, onClear }: Props) {
  const { items, totalBytes, sentBytes, bytesPerSecond, active, failed, done } = snapshot;
  if (items.length === 0) return null;
  const percent = totalBytes > 0 ? (sentBytes / totalBytes) * 100 : active ? 0 : 100;
  const ordered = [
    ...items.filter((i) => i.status === 'error'),
    ...items.filter((i) => i.status === 'uploading'),
    ...items.filter((i) => i.status === 'queued'),
    ...items.filter((i) => i.status === 'done' || i.status === 'canceled').reverse(),
  ].slice(0, VISIBLE_ROWS);

  return (
    <section aria-label="Uploads" className="rounded-2xl border border-border bg-card/80 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {active ? `Uploading ${active} file${active === 1 ? '' : 's'}` : failed ? `${failed} upload${failed === 1 ? '' : 's'} failed` : 'Uploads complete'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {formatBytes(sentBytes)} of {formatBytes(totalBytes)} · {done} of {items.length} done
            {active > 0 && bytesPerSecond > 0 && ` · ${formatSpeed(bytesPerSecond)} · ${formatEta(totalBytes - sentBytes, bytesPerSecond)}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {failed > 0 && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw /> Retry
            </Button>
          )}
          {active > 0 ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button size="icon-sm" variant="ghost" onClick={onClear} aria-label="Clear finished uploads">
              <X />
            </Button>
          )}
        </div>
      </div>
      <Progress value={percent} className="mt-3 h-1.5" />
      <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1 text-sm">
        {ordered.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            {item.status === 'done' ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
            ) : item.status === 'error' ? (
              <XCircle className="size-4 shrink-0 text-destructive" />
            ) : item.status === 'canceled' ? (
              <X className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Loader2 className={`size-4 shrink-0 text-muted-foreground ${item.status === 'uploading' ? 'animate-spin' : ''}`} />
            )}
            <span className="min-w-0 flex-1 truncate" title={item.path}>
              {item.path}
            </span>
            {item.encrypted && <Lock className="size-3 shrink-0 text-emerald-300" aria-label="Encrypted" />}
            <span className={`shrink-0 text-xs tabular-nums ${item.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {item.status === 'error'
                ? item.error
                : item.status === 'uploading'
                  ? `${Math.floor((item.sent / Math.max(1, item.size)) * 100)}%`
                  : item.status === 'queued'
                    ? 'Waiting'
                    : item.status === 'canceled'
                      ? 'Canceled'
                      : formatBytes(item.size)}
            </span>
          </li>
        ))}
        {items.length > VISIBLE_ROWS && (
          <li className="text-xs text-muted-foreground">and {items.length - VISIBLE_ROWS} more…</li>
        )}
      </ul>
    </section>
  );
}
