'use client';

import { CheckCircle2, Loader2, Lock, RotateCcw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatSpeed } from '@/components/nas/format';
import type { UploadSnapshot } from '@/lib/client/upload';

interface Props {
  snapshot: UploadSnapshot;
  onRetry: () => void;
  onCancel: () => void;
  onClear: () => void;
}

function timeLeft(s: UploadSnapshot): string {
  const remainingBytes = s.totalBytes - s.sentBytes;
  const remainingFiles = s.totalFiles - s.doneFiles - s.skippedFiles - s.failedFiles;
  const byBytes = s.bytesPerSecond > 0 ? remainingBytes / s.bytesPerSecond : 0;
  const byFiles = s.filesPerSecond > 0 ? remainingFiles / s.filesPerSecond : 0;
  const secs = Math.ceil(Math.max(byBytes, byFiles));
  if (!secs) return 'Estimating time…';
  if (secs < 60) return `${secs}s left`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s left`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m left`;
}

const n = (x: number) => x.toLocaleString();

export function UploadPanel({ snapshot: s, onRetry, onCancel, onClear }: Props) {
  if (s.totalFiles === 0) return null;
  const finished = s.doneFiles + s.skippedFiles;
  const percent = s.totalBytes > 0 ? (s.sentBytes / s.totalBytes) * 100 : (finished / s.totalFiles) * 100;

  return (
    <section aria-label="Uploads" className="rounded-2xl border border-border bg-card/80 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {s.running
              ? s.verifying > 0 && s.current.length === 0
                ? `Comparing ${n(s.verifying)} files…`
                : `Uploading ${n(s.totalFiles - finished - s.failedFiles)} files`
              : s.failedFiles
                ? `${n(s.failedFiles)} upload${s.failedFiles === 1 ? '' : 's'} failed`
                : 'Upload complete'}
          </h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {n(finished)} of {n(s.totalFiles)} files · {formatBytes(s.sentBytes)} of {formatBytes(s.totalBytes)}
            {s.skippedFiles > 0 && ` · ${n(s.skippedFiles)} identical skipped`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {s.failedFiles > 0 && !s.running && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw /> Retry
            </Button>
          )}
          {s.running ? (
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

      <Progress value={percent} className="mt-3 h-2" />
      {s.running && (
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{Math.floor(percent)}%</span>
          <span>
            {[formatSpeed(s.bytesPerSecond), s.filesPerSecond >= 1 ? `${Math.round(s.filesPerSecond)} files/s` : '', timeLeft(s)]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}

      <ul className="mt-3 space-y-1.5 text-sm">
        {s.failures.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <XCircle className="size-4 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 truncate" title={item.path}>
              {item.path}
            </span>
            <span className="max-w-[45%] shrink-0 truncate text-xs text-destructive">{item.error}</span>
          </li>
        ))}
        {s.current.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={item.path}>
              {item.path}
            </span>
            {item.encrypted && <Lock className="size-3 shrink-0 text-emerald-300" aria-label="Encrypted" />}
          </li>
        ))}
        {!s.running &&
          s.recent.slice(0, 3).map((path) => (
            <li key={path} className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{path}</span>
            </li>
          ))}
      </ul>
    </section>
  );
}
