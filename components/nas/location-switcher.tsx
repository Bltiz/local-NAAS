'use client';

import { useState } from 'react';
import { Check, ChevronDown, Cloud, Monitor, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface InstanceInfo {
  self: { mode: 'server' | 'local'; name: string; urls: string[] };
  known: { id: string; name: string; urls: string[]; online: boolean; lastSeen: string; lastSyncAt: string | null }[];
  serverUrl: string | null;
}

interface SavedLocation {
  name: string;
  url: string;
}

const SAVED_KEY = 'nas-locations';

function loadSaved(): SavedLocation[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function formatAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function LocationSwitcher({ info }: { info: InstanceInfo | null }) {
  const [saved, setSaved] = useState<SavedLocation[]>(() => (typeof window === 'undefined' ? [] : loadSaved()));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  if (!info) return null;
  const isLocal = info.self.mode === 'local';
  const open = (target: string) => {
    window.location.href = target;
  };
  const persist = (next: SavedLocation[]) => {
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };

  const addLocation = (e: React.FormEvent) => {
    e.preventDefault();
    let origin: string;
    try {
      const parsed = new URL(url.trim().includes('://') ? url.trim() : `http://${url.trim()}`);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
      origin = parsed.origin;
    } catch {
      return setError('Enter an address like http://192.168.1.20:43214 or https://your-app.up.railway.app');
    }
    persist([...saved.filter((s) => s.url !== origin), { name: name.trim() || hostOf(origin), url: origin }]);
    setAdding(false);
    setName('');
    setUrl('');
    setError('');
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className={isLocal ? 'border-sky-400/40 text-sky-100' : ''} aria-label="Switch between server and local" />
          }
        >
          {isLocal ? <Monitor /> : <Cloud />}
          <span className="max-w-[9rem] truncate">{isLocal ? info.self.name : 'Server'}</span>
          <ChevronDown className="opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Switch location</DropdownMenuLabel>
            <DropdownMenuItem disabled>
              {isLocal ? <Monitor /> : <Cloud />}
              <span className="flex-1 truncate">{isLocal ? `${info.self.name} (local)` : 'Server'}</span>
              <Check className="text-emerald-400" />
            </DropdownMenuItem>

            {isLocal && info.serverUrl && (
              <DropdownMenuItem onClick={() => open(info.serverUrl!)}>
                <Cloud />
                <span className="flex-1 truncate">Server · {hostOf(info.serverUrl)}</span>
              </DropdownMenuItem>
            )}

            {!isLocal &&
              info.known.flatMap((k) =>
                (k.urls.length ? k.urls : ['']).map((u) => (
                  <DropdownMenuItem key={`${k.id}-${u}`} disabled={!u} onClick={() => u && open(u)}>
                    <Monitor />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {k.name}
                        {u && <span className="text-muted-foreground"> · {hostOf(u)}</span>}
                      </span>
                      <span className={`block text-[11px] ${k.online ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                        {k.online ? 'Online' : `Last seen ${formatAgo(k.lastSeen)}`} · backed up {formatAgo(k.lastSyncAt)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                )),
              )}

            {saved
              .filter((s) => s.url !== window.location.origin)
              .map((s) => (
                <DropdownMenuItem key={s.url} onClick={() => open(s.url)}>
                  {s.url.startsWith('https:') ? <Cloud /> : <Monitor />}
                  <span className="min-w-0 flex-1 truncate">
                    {s.name} <span className="text-muted-foreground">· {hostOf(s.url)}</span>
                  </span>
                  <button
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${s.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      persist(saved.filter((x) => x.url !== s.url));
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAdding(true)}>
            <Plus /> Add a location…
          </DropdownMenuItem>
          <p className="px-2 pt-1 pb-1.5 text-[11px] leading-snug text-muted-foreground">
            {isLocal
              ? 'Connect a server under “Backup to server” and it shows up here automatically.'
              : 'A PC running Local NAS with backup turned on shows up here. Local addresses only work on the same Wi-Fi as that PC.'}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a location</DialogTitle>
            <DialogDescription>Save the address of another Local NAS so you can switch to it in one click.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addLocation} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="loc-name">Name</Label>
              <Input id="loc-name" placeholder="Lucid's PC" value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-url">Address</Label>
              <Input id="loc-url" placeholder="http://192.168.1.20:43214" value={url} onChange={(e) => setUrl(e.target.value)} className="h-10" autoFocus />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={!url.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
