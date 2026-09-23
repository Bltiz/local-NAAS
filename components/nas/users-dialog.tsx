'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/components/nas/format';

interface User {
  id: string;
  name: string;
  access: 'all' | 'home';
  home: string | null;
  createdAt: string;
}

function AccessPicker({ value, onChange }: { value: 'all' | 'home'; onChange: (v: 'all' | 'home') => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" size="sm" variant={value === 'home' ? 'default' : 'outline'} onClick={() => onChange('home')}>
        Only their own folder
      </Button>
      <Button type="button" size="sm" variant={value === 'all' ? 'default' : 'outline'} onClick={() => onChange('all')}>
        Everything
      </Button>
    </div>
  );
}

export function UsersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<'all' | 'home'>('home');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/users', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setUsers(data.users);
    setEnabled(data.enabled);
  }, []);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    fetch('/api/users', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (canceled || !d) return;
        setUsers(d.users);
        setEnabled(d.enabled);
      });
    return () => {
      canceled = true;
    };
  }, [open]);

  const call = async (method: string, body?: object, query = '') => {
    const res = await fetch(`/api/users${query}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
    return data;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await call('POST', { name, password, access });
      toast.success(`Added ${name.trim().toLowerCase()}`);
      setName('');
      setPassword('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add that user');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5" /> Users
          </DialogTitle>
          <DialogDescription>
            Give family or friends their own sign-in. “Only their own folder” users see just <span className="font-mono">Users/&lt;name&gt;</span> as their whole NAS. You
            stay the admin with the main password.
          </DialogDescription>
        </DialogHeader>

        {!enabled ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Set a main password (NAS_PASSWORD) first. Without it, anyone can already use this NAS, so separate users wouldn’t mean anything.
          </p>
        ) : (
          <form onSubmit={add} className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="u-name">Username</Label>
                <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className="h-9" placeholder="sam" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-pass">Password</Label>
                <Input id="u-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className="h-9" placeholder="At least 8 characters" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Can see</Label>
              <AccessPicker value={access} onChange={setAccess} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || !name || !password}>
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Add user
            </Button>
          </form>
        )}

        {users === null ? (
          <Loader2 className="mx-auto my-6 size-6 animate-spin text-muted-foreground" />
        ) : users.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No other users yet.</p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {users.map((u) => (
              <li key={u.id} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.access === 'all' ? 'Sees everything' : `Sees only ${u.home}`} · added {formatDate(u.createdAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setResetFor(resetFor === u.id ? null : u.id)}>
                    <KeyRound /> Password
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => call('PATCH', { id: u.id, access: u.access === 'all' ? 'home' : 'all' }).then(load).catch((e) => toast.error(e.message))}
                  >
                    {u.access === 'all' ? 'Limit to own folder' : 'Allow everything'}
                  </Button>
                  {confirmDelete === u.id ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        call('DELETE', undefined, `?id=${u.id}`)
                          .then(() => {
                            setConfirmDelete(null);
                            load();
                          })
                          .catch((e) => toast.error(e.message))
                      }
                    >
                      Remove {u.name}
                    </Button>
                  ) : (
                    <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(u.id)} aria-label={`Remove ${u.name}`}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {confirmDelete === u.id && <p className="mt-2 text-xs text-muted-foreground">Their sign-in stops working. Their files stay in {u.home ?? 'place'}.</p>}
                {resetFor === u.id && (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      call('PATCH', { id: u.id, password: newPassword })
                        .then(() => {
                          toast.success(`Password changed. ${u.name} is signed out everywhere.`);
                          setResetFor(null);
                          setNewPassword('');
                        })
                        .catch((err) => toast.error(err.message));
                    }}
                  >
                    <Input type="text" autoComplete="off" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-8" />
                    <Button size="sm" type="submit" disabled={newPassword.length < 8}>
                      Save
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
