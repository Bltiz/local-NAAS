'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/components/nas/format';
import { type FileEntry, displayName, isEncrypted } from '@/lib/client/download';

export interface ShareLink {
  id: string;
  path: string;
  type: 'file' | 'dir';
  createdByName: string;
  createdAt: string;
  expiresAt: string | null;
  hasPassword: boolean;
  downloads: number;
}

export const shareUrl = (id: string) => `${window.location.origin}/s/${id}`;

const EXPIRY = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Never', days: null },
] as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function LinkRow({ link, onRevoke, showPath }: { link: ShareLink; onRevoke: () => void; showPath?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5">
      <Link2 className="size-4 shrink-0 text-violet-300" />
      <div className="min-w-0 flex-1">
        {showPath && <p className="truncate text-sm font-medium">{link.path}</p>}
        <p className="truncate font-mono text-xs text-muted-foreground">{shareUrl(link.id)}</p>
        <p className="text-xs text-muted-foreground">
          {link.expiresAt ? `Expires ${formatDate(link.expiresAt)}` : 'Never expires'}
          {link.hasPassword && ' · password'} · {link.downloads} download{link.downloads === 1 ? '' : 's'}
          {showPath && link.createdByName !== 'admin' && ` · by ${link.createdByName}`}
        </p>
      </div>
      <CopyButton text={shareUrl(link.id)} />
      <Button size="icon-sm" variant="ghost" onClick={onRevoke} aria-label="Turn off link">
        <Trash2 />
      </Button>
    </li>
  );
}

export function ShareDialog({ entry, onClose }: { entry: FileEntry | null; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [days, setDays] = useState<number | null>(7);
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!entry) return;
    let canceled = false;
    fetch(`/api/shares?path=${encodeURIComponent(entry.path)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => !canceled && setLinks(d.shares ?? []))
      .catch(() => !canceled && setLinks([]));
    return () => {
      canceled = true;
    };
  }, [entry]);

  const create = async () => {
    if (!entry) return;
    setCreating(true);
    const res = await fetch('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: entry.path, expiresInDays: days, password: password || null }),
    });
    setCreating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error ?? 'Couldn’t create the link.');
    setLinks((prev) => [data.share, ...(prev ?? [])]);
    setPassword('');
    await navigator.clipboard.writeText(shareUrl(data.share.id)).catch(() => {});
    toast.success('Link created and copied');
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/shares?id=${id}`, { method: 'DELETE' });
    if (!res.ok) return toast.error('Couldn’t turn off that link.');
    setLinks((prev) => (prev ?? []).filter((l) => l.id !== id));
  };

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(o) => {
        if (!o) {
          setLinks(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">Share “{entry ? displayName(entry.path) : ''}”</DialogTitle>
          <DialogDescription>Anyone with the link can {entry?.type === 'dir' ? 'browse and download this folder' : 'download this file'}, no account needed.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Link expires after</Label>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY.map((o) => (
                <Button key={o.label} type="button" size="sm" variant={days === o.days ? 'default' : 'outline'} onClick={() => setDays(o.days)}>
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-pass">Password (optional)</Label>
            <Input id="share-pass" type="text" autoComplete="off" placeholder="Leave empty for no password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-9" />
          </div>
          {entry && (isEncrypted(entry.path) || entry.type === 'dir') && (
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0 text-emerald-300" />
              {entry.type === 'dir' ? 'If this folder has encrypted files, the' : 'This file is encrypted. The'} recipient also needs your encryption passphrase to open
              {entry.type === 'dir' ? ' them' : ' it'}.
            </p>
          )}
          <Button onClick={create} disabled={creating} className="w-full">
            {creating ? <Loader2 className="animate-spin" /> : <Link2 />} Create link
          </Button>
        </div>

        {links === null ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : (
          links.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Active links</p>
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {links.map((l) => (
                  <LinkRow key={l.id} link={l} onRevoke={() => revoke(l.id)} />
                ))}
              </ul>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SharedLinksDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    fetch('/api/shares', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => !canceled && setLinks(d.shares ?? []))
      .catch(() => !canceled && setLinks([]));
    return () => {
      canceled = true;
    };
  }, [open]);

  const revoke = async (id: string) => {
    const res = await fetch(`/api/shares?id=${id}`, { method: 'DELETE' });
    if (!res.ok) return toast.error('Couldn’t turn off that link.');
    setLinks((prev) => (prev ?? []).filter((l) => l.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-5" /> Shared links
          </DialogTitle>
          <DialogDescription>Every active link. Turning one off stops it working immediately.</DialogDescription>
        </DialogHeader>
        {links === null ? (
          <Loader2 className="mx-auto my-8 size-6 animate-spin text-muted-foreground" />
        ) : links.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No shared links yet. Use “Share link…” on any file or folder.</p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {links.map((l) => (
              <LinkRow key={l.id} link={l} showPath onRevoke={() => revoke(l.id)} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
