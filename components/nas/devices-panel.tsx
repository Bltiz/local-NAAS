'use client';

import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, FolderUp, Laptop, Pencil, Radio, Smartphone, Upload, X, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatEta, formatSpeed } from '@/components/nas/format';
import { type Picked, entriesFromDrop, fromFileList } from '@/lib/client/pick';
import type { DirectSnapshot, Peer, Transfer } from '@/lib/client/rtc';

interface Props {
  snapshot: DirectSnapshot;
  onSend: (peer: Peer, picked: Picked) => void;
  onSendEntries: (peer: Peer, entries: FileSystemEntry[]) => void;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  onRename: (name: string) => void;
}

const DeviceIcon = ({ name, className }: { name: string; className?: string }) =>
  /iPhone|Android|iPad/.test(name) ? <Smartphone className={className} /> : <Laptop className={className} />;

function summary(t: Transfer) {
  const count = t.files.length;
  return `${count} file${count === 1 ? '' : 's'} · ${formatBytes(t.totalBytes)}`;
}

function TransferRow({ t, onCancel, onDismiss }: { t: Transfer; onCancel: () => void; onDismiss: () => void }) {
  const finished = ['done', 'declined', 'failed', 'canceled'].includes(t.status);
  const percent = t.totalBytes ? (t.bytes / t.totalBytes) * 100 : t.status === 'done' ? 100 : 0;
  const label: Record<Transfer['status'], string> = {
    requesting: `Waiting for ${t.peer.name} to accept…`,
    incoming: 'Waiting for you',
    connecting: 'Connecting directly…',
    transferring: `${formatBytes(t.bytes)} of ${formatBytes(t.totalBytes)}${t.bytesPerSecond ? ` · ${formatSpeed(t.bytesPerSecond)} · ${formatEta(t.totalBytes - t.bytes, t.bytesPerSecond)}` : ''}`,
    done: t.direction === 'receive' ? `Saved to ${t.savedTo ?? 'your device'}` : 'Delivered',
    declined: `${t.peer.name} declined`,
    failed: t.error ?? 'Transfer failed',
    canceled: t.error ?? 'Canceled',
  };
  return (
    <li className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start gap-2">
        {t.direction === 'send' ? (
          <ArrowUpFromLine className="mt-0.5 size-4 shrink-0 text-violet-300" />
        ) : (
          <ArrowDownToLine className="mt-0.5 size-4 shrink-0 text-emerald-300" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {t.direction === 'send' ? 'To' : 'From'} {t.peer.name}
            <span className="font-normal text-muted-foreground"> · {summary(t)}</span>
          </p>
          <p className={`truncate text-xs ${t.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{label[t.status]}</p>
        </div>
        {t.route && t.status !== 'failed' && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {t.route === 'Same network' && <Zap className="size-3 text-amber-300" />}
            {t.route}
          </Badge>
        )}
        <Button size="icon-xs" variant="ghost" onClick={finished ? onDismiss : onCancel} aria-label={finished ? 'Dismiss' : 'Cancel transfer'}>
          <X />
        </Button>
      </div>
      {(t.status === 'transferring' || t.status === 'done') && <Progress value={percent} className="mt-2 h-1" />}
    </li>
  );
}

export function DevicesPanel({ snapshot, onSend, onSendEntries, onAccept, onDecline, onCancel, onDismiss, onRename }: Props) {
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const target = useRef<Peer | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const incoming = snapshot.transfers.filter((t) => t.status === 'incoming');
  const others = snapshot.transfers.filter((t) => t.status !== 'incoming');

  const pick = (peer: Peer, folder: boolean) => {
    target.current = peer;
    (folder ? folderInput : filesInput).current?.click();
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length && target.current) onSend(target.current, fromFileList(e.target.files));
    e.target.value = '';
  };

  return (
    <section aria-labelledby="direct-title" className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="direct-title" className="flex items-center gap-2 font-semibold">
          <Zap className="size-4 text-amber-300" /> Send directly
        </h2>
        <span className={`flex items-center gap-1.5 text-xs ${snapshot.online ? 'text-emerald-300' : 'text-muted-foreground'}`}>
          <span className={`size-2 rounded-full ${snapshot.online ? 'bg-emerald-400' : 'bg-muted-foreground'}`} />
          {snapshot.online ? 'Online' : 'Connecting…'}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Device to device with WebRTC. Files skip the cloud, so it’s fastest when both devices are on the same Wi-Fi.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-background/40 px-3 py-2 text-sm">
        <DeviceIcon name={snapshot.selfName} className="size-4 shrink-0 text-muted-foreground" />
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              onRename(draftName);
              setRenaming(false);
            }}
          >
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus maxLength={60} className="h-7" aria-label="Device name" />
            <Button type="submit" size="icon-xs" variant="ghost" aria-label="Save name">
              <Check />
            </Button>
          </form>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">This device: </span>
              {snapshot.selfName}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Rename this device"
              onClick={() => {
                setDraftName(snapshot.selfName);
                setRenaming(true);
              }}
            >
              <Pencil />
            </Button>
          </>
        )}
      </div>

      {incoming.map((t) => (
        <div key={t.id} role="alert" className="mt-3 rounded-lg border border-emerald-400/40 bg-emerald-400/10 p-3">
          <p className="text-sm font-medium">{t.peer.name} wants to send you {summary(t)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.files.slice(0, 3).map((f) => f.path).join(', ')}{t.files.length > 3 ? '…' : ''}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => onAccept(t.id)}>
              Accept & choose where to save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDecline(t.id)}>
              Decline
            </Button>
          </div>
        </div>
      ))}

      <ul className="mt-3 space-y-2">
        {snapshot.peers.map((peer) => (
          <li
            key={peer.id}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropTarget(peer.id);
            }}
            onDragLeave={() => setDropTarget((d) => (d === peer.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropTarget(null);
              const entries = entriesFromDrop(e.dataTransfer);
              if (entries) onSendEntries(peer, entries);
              else if (e.dataTransfer.files.length) onSend(peer, fromFileList(e.dataTransfer.files));
            }}
            className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 transition-colors ${dropTarget === peer.id ? 'border-primary bg-primary/15' : 'border-border bg-background/40'}`}
          >
            <DeviceIcon name={peer.name} className="size-5 shrink-0 text-violet-300" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{peer.name}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => pick(peer, false)}>
                <Upload /> Files
              </Button>
              <Button size="sm" variant="outline" onClick={() => pick(peer, true)}>
                <FolderUp /> Folder
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {snapshot.peers.length === 0 && (
        <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <Radio className="mb-2 size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No other devices online</p>
          <p className="mt-1 text-xs text-muted-foreground">Open Local NAS on your laptop or phone and sign in. It will appear here.</p>
        </div>
      )}

      {others.length > 0 && <ul className="mt-3 space-y-2">{others.map((t) => <TransferRow key={t.id} t={t} onCancel={() => onCancel(t.id)} onDismiss={() => onDismiss(t.id)} />)}</ul>}

      <input ref={filesInput} type="file" multiple hidden onChange={onPicked} />
      <input ref={folderInput} type="file" hidden onChange={onPicked} {...{ webkitdirectory: '', directory: '' }} />
    </section>
  );
}
