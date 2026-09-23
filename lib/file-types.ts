export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus',
  pdf: 'application/pdf',
  json: 'application/json',
  zip: 'application/zip',
};

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'jsonc', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php',
  'swift', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'gitignore', 'dockerfile', 'makefile', 'lua', 'r', 'dart', 'gradle', 'properties', 'srt', 'vtt',
]);

export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot < 0) return base;
  return base.slice(dot + 1);
}

export function mimeTypeOf(name: string): string {
  const ext = extensionOf(name);
  if (MIME[ext]) return MIME[ext];
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export function previewKindOf(name: string): PreviewKind {
  const ext = extensionOf(name);
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  const mime = MIME[ext];
  if (!mime) return 'none';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'none';
}
