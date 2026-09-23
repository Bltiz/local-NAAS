'use client';

import { useEffect, useState } from 'react';
import { Download, FileQuestion, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatBytes } from '@/components/nas/format';
import type { EncryptionSession } from '@/lib/client/crypto';
import { type FileEntry, displayName, displaySize, downloadUrl, isEncrypted, readAsBlob } from '@/lib/client/download';
import { mimeTypeOf, previewKindOf } from '@/lib/file-types';

const TEXT_LIMIT = 1024 * 1024;
const ENCRYPTED_PREVIEW_LIMIT = 1024 * 1024 * 1024;

type Content =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'locked' }
  | { state: 'unsupported' }
  | { state: 'media'; url: string }
  | { state: 'text'; text: string; truncated: boolean };

interface Props {
  entry: FileEntry | null;
  session: EncryptionSession | null;
  onClose: () => void;
  onDownload: (entry: FileEntry) => void;
  onUnlock: () => void;
}

export function PreviewDialog({ entry, session, onClose, onDownload, onUnlock }: Props) {
  const [content, setContent] = useState<Content>({ state: 'loading' });

  useEffect(() => {
    if (!entry) return;
    const name = displayName(entry.path);
    const kind = previewKindOf(name);
    const encrypted = isEncrypted(entry.path);
    let objectUrl: string | null = null;
    let canceled = false;
    const set = (c: Content) => !canceled && setContent(c);

    (async () => {
      set({ state: 'loading' });
      if (kind === 'none') return set({ state: 'unsupported' });
      if (encrypted && !session) return set({ state: 'locked' });
      if (encrypted && displaySize(entry) > ENCRYPTED_PREVIEW_LIMIT) {
        return set({ state: 'error', message: 'This encrypted file is too large to preview. Download it instead.' });
      }
      try {
        if (kind === 'text') {
          let text: string;
          let truncated = false;
          if (encrypted) {
            const blob = await readAsBlob(entry, session, 'text/plain');
            truncated = blob.size > TEXT_LIMIT;
            text = await blob.slice(0, TEXT_LIMIT).text();
          } else {
            const res = await fetch(downloadUrl(entry.path, true), { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } });
            if (!res.ok) throw new Error(`Could not load file (${res.status})`);
            text = await res.text();
            truncated = entry.size > TEXT_LIMIT;
          }
          return set({ state: 'text', text, truncated });
        }
        if (!encrypted && kind !== 'pdf') return set({ state: 'media', url: downloadUrl(entry.path, true) });
        const blob = await readAsBlob(entry, session, mimeTypeOf(name));
        if (canceled) return;
        objectUrl = URL.createObjectURL(blob);
        set({ state: 'media', url: objectUrl });
      } catch (error) {
        set({ state: 'error', message: error instanceof Error ? error.message : 'Could not load preview.' });
      }
    })();

    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry, session]);

  const name = entry ? displayName(entry.path) : '';
  const kind = previewKindOf(name);

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader className="pr-10">
          <DialogTitle className="flex items-center gap-2 truncate">
            {entry && isEncrypted(entry.path) && <Lock className="size-4 shrink-0 text-emerald-300" />}
            <span className="truncate">{name}</span>
          </DialogTitle>
          <DialogDescription className="truncate">
            {entry && `${formatBytes(displaySize(entry))} · ${entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : 'All files'}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[40vh] flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/40">
          {content.state === 'loading' && <Loader2 className="size-8 animate-spin text-muted-foreground" />}
          {content.state === 'error' && <p className="px-6 text-center text-sm text-destructive">{content.message}</p>}
          {content.state === 'unsupported' && (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-muted-foreground">
              <FileQuestion className="size-10" />
              <p>There’s no preview for this type of file.</p>
            </div>
          )}
          {content.state === 'locked' && (
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <Lock className="size-10 text-emerald-300" />
              <p className="text-sm text-muted-foreground">This file is encrypted. Enter your encryption passphrase to preview it.</p>
              <Button onClick={onUnlock}>Unlock encrypted files</Button>
            </div>
          )}
          {content.state === 'media' && kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.url} alt={name} className="max-h-[70vh] max-w-full object-contain" />
          )}
          {content.state === 'media' && kind === 'video' && (
            <video src={content.url} controls autoPlay className="max-h-[70vh] w-full" />
          )}
          {content.state === 'media' && kind === 'audio' && <audio src={content.url} controls autoPlay className="w-full max-w-lg" />}
          {content.state === 'media' && kind === 'pdf' && <iframe src={content.url} title={name} className="h-[70vh] w-full bg-white" />}
          {content.state === 'text' && (
            <pre className="h-[70vh] w-full self-stretch overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
              {content.text}
              {content.truncated && '\n\n… Preview shows the first 1 MB. Download the file to see all of it.'}
            </pre>
          )}
        </div>

        <div className="flex justify-end">
          {entry && (
            <Button variant="outline" onClick={() => onDownload(entry)}>
              <Download /> Download
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
