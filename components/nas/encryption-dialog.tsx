'use client';

import { useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unlocked: boolean;
  encryptUploads: boolean;
  onEncryptUploadsChange: (value: boolean) => void;
  onUnlock: (passphrase: string, encryptUploads: boolean) => void;
  onLock: () => void;
}

export function EncryptionDialog({ open, onOpenChange, unlocked, encryptUploads, onEncryptUploadsChange, onUnlock, onLock }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [encryptNew, setEncryptNew] = useState(true);
  const [error, setError] = useState('');

  const reset = () => {
    setPassphrase('');
    setConfirm('');
    setError('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < 8) return setError('Use at least 8 characters.');
    if (passphrase !== confirm) return setError('The two passphrases don’t match.');
    onUnlock(passphrase, encryptNew);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-emerald-300" /> File encryption
          </DialogTitle>
          <DialogDescription>
            Files are encrypted on this device before they upload, so the server only ever stores scrambled data.
          </DialogDescription>
        </DialogHeader>

        {unlocked ? (
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Encrypt new uploads</span>
                <span className="block text-xs text-muted-foreground">Encrypted files can still be previewed and downloaded here.</span>
              </span>
              <Switch checked={encryptUploads} onCheckedChange={onEncryptUploadsChange} />
            </label>
            <p className="text-xs text-muted-foreground">
              Your passphrase is kept in this tab only. Closing or reloading the tab forgets it.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  onLock();
                  onOpenChange(false);
                }}
              >
                Forget passphrase
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="enc-pass">Passphrase</Label>
              <Input
                id="enc-pass"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enc-confirm">Type it again</Label>
              <Input
                id="enc-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-10"
              />
            </div>
            <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <span className="text-sm font-medium">Encrypt new uploads</span>
              <Switch checked={encryptNew} onCheckedChange={setEncryptNew} />
            </label>
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              <ShieldAlert className="size-4 shrink-0 text-amber-300" />
              <p>
                There is no way to recover encrypted files if you forget this passphrase. Use the same passphrase on every
                device. File and folder names are not encrypted.
              </p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" className="w-full sm:w-auto">
                Unlock
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
