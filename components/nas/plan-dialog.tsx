'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Lock, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/components/nas/format';
import { REBUILDABLE } from '@/lib/client/pick';
import { type UploadPlan, planTotals } from '@/lib/client/plan';

export interface SpeedHistory {
  bytesPerSecond: number;
  filesPerSecond: number;
}

interface Props {
  scanning: number | null;
  plan: UploadPlan | null;
  freeBytes: number | null;
  speed: SpeedHistory | null;
  sendTo?: string | null;
  onConfirm: (skip: Set<string>) => void;
  onCancel: () => void;
}

function estimate(bytes: number, files: number, speed: SpeedHistory | null): string | null {
  if (!speed || (speed.bytesPerSecond <= 0 && speed.filesPerSecond <= 0)) return null;
  const byBytes = speed.bytesPerSecond > 0 ? bytes / speed.bytesPerSecond : 0;
  const byFiles = speed.filesPerSecond > 0 ? files / speed.filesPerSecond : 0;
  const s = Math.max(byBytes, byFiles);
  if (s < 60) return 'under a minute';
  if (s < 3600) return `about ${Math.round(s / 60)} min`;
  return `about ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

const n = (x: number) => x.toLocaleString();

export function PlanDialog({ scanning, plan, freeBytes, speed, sendTo, onConfirm, onCancel }: Props) {
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const open = scanning !== null || plan !== null;
  const totals = useMemo(() => (plan ? planTotals(plan, skip) : null), [plan, skip]);
  const withAll = useMemo(() => (plan ? planTotals(plan, new Set()) : null), [plan]);
  const tooBig = !sendTo && totals && freeBytes !== null && totals.uploadBytes > freeBytes;
  const eta = totals && !sendTo ? estimate(totals.uploadBytes, totals.uploadFiles, speed) : null;

  const toggle = (name: string, on: boolean) =>
    setSkip((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSkip(new Set());
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {!plan ? 'Reading your files' : sendTo ? `Send directly to ${sendTo}` : `Upload to ${plan.dest ? `“${plan.dest}”` : 'All files'}`}
          </DialogTitle>
          <DialogDescription>
            {!plan
              ? 'Counting files and folders so nothing is missed.'
              : sendTo
                ? 'Files go straight to the other device and keep their folder structure. They don’t pass through the server.'
                : 'Folders are merged into what’s already on the NAS. Unchanged files are skipped; changed files replace the old version, which goes to Trash.'}
          </DialogDescription>
        </DialogHeader>

        {!plan || !totals || !withAll ? (
          <div className="flex items-center gap-3 rounded-lg bg-background/40 p-4">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p className="text-sm">
              Scanning… <span className="font-medium tabular-nums">{n(scanning ?? 0)}</span> files found
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {!sendTo && (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {[
                ['New', totals.newFiles],
                ['Changed', totals.changedFiles],
                ['Double-check', totals.checkFiles],
                ['Already there', totals.sameFiles],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border border-border bg-background/40 p-2.5">
                  <p className="text-lg font-semibold tabular-nums">{n(value as number)}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            )}
            {totals.checkFiles > 0 && (
              <p className="text-xs text-muted-foreground">
                “Double-check” files match in size but not date, so their contents are compared first and skipped if identical.
              </p>
            )}

            {plan.rebuild.length > 0 && (
              <div className="rounded-lg border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <PackageOpen className="size-4 text-amber-300" /> Rebuildable folders
                  </p>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSkip(skip.size === plan.rebuild.length ? new Set() : new Set(plan.rebuild.map((g) => g.name)))}
                  >
                    {skip.size === plan.rebuild.length ? 'Include all' : 'Skip all'}
                  </Button>
                </div>
                <ul className="max-h-44 divide-y divide-border overflow-y-auto">
                  {plan.rebuild.map((g) => (
                    <li key={g.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs">{g.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {n(g.files)} files · {formatBytes(g.bytes)} · recreated by {REBUILDABLE.get(g.name)}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Skip
                        <Switch checked={skip.has(g.name)} onCheckedChange={(on) => toggle(g.name, on)} />
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg bg-background/40 p-3 text-sm">
              {totals.uploadFiles === 0 ? (
                <p className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="size-4" /> Everything is already on the NAS.
                </p>
              ) : (
                <>
                  <p>
                    <span className="font-semibold">{n(totals.uploadFiles)}</span> files ·{' '}
                    <span className="font-semibold">{formatBytes(totals.uploadBytes)}</span> to send
                    {totals.skippedFiles > 0 && (
                      <span className="text-muted-foreground">
                        {' '}
                        (instead of {n(withAll.uploadFiles)} · {formatBytes(withAll.uploadBytes)})
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {sendTo
                      ? 'The other device will be asked to accept.'
                      : eta
                        ? `Estimated time: ${eta}, based on your last upload speed.`
                        : 'A time estimate appears once the upload starts.'}
                    {plan.encrypted && (
                      <span className="ml-1 inline-flex items-center gap-1 text-emerald-300">
                        <Lock className="size-3" /> Encrypted
                      </span>
                    )}
                  </p>
                </>
              )}
            </div>

            {tooBig && (
              <p className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                This needs {formatBytes(totals.uploadBytes)} but only {formatBytes(freeBytes ?? 0)} is free. Skip rebuildable folders or
                make the storage bigger first.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSkip(new Set());
              onCancel();
            }}
          >
            Cancel
          </Button>
          {plan && totals && (totals.uploadFiles > 0 || plan.emptyDirs.length > 0) && (
            <Button
              disabled={Boolean(tooBig)}
              onClick={() => {
                onConfirm(skip);
                setSkip(new Set());
              }}
            >
              {totals.uploadFiles > 0
                ? `${sendTo ? 'Send' : 'Upload'} ${n(totals.uploadFiles)} file${totals.uploadFiles === 1 ? '' : 's'}`
                : `Create ${n(plan.emptyDirs.length)} empty folder${plan.emptyDirs.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
