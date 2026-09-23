import { File, FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder } from 'lucide-react';
import { extensionOf, previewKindOf } from '@/lib/file-types';

const ARCHIVES = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
const CODE = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'php', 'html', 'css', 'json', 'sh']);

export function FileIcon({ name, isDir, className }: { name: string; isDir?: boolean; className?: string }) {
  if (isDir) return <Folder className={`${className} text-amber-300`} />;
  const ext = extensionOf(name);
  if (ARCHIVES.has(ext)) return <FileArchive className={`${className} text-orange-300`} />;
  if (CODE.has(ext)) return <FileCode className={`${className} text-sky-300`} />;
  switch (previewKindOf(name)) {
    case 'image':
      return <FileImage className={`${className} text-emerald-300`} />;
    case 'video':
      return <FileVideo className={`${className} text-rose-300`} />;
    case 'audio':
      return <FileAudio className={`${className} text-pink-300`} />;
    case 'pdf':
    case 'text':
      return <FileText className={`${className} text-violet-200`} />;
    default:
      return <File className={`${className} text-violet-300`} />;
  }
}
