// Folders that tools recreate on demand. Shown in the upload summary so they can be skipped.
export const REBUILDABLE = new Map<string, string>([
  ['node_modules', 'npm install'],
  ['.next', 'next build'],
  ['.nuxt', 'nuxt build'],
  ['.svelte-kit', 'svelte-kit sync'],
  ['.turbo', 'turbo cache'],
  ['.parcel-cache', 'parcel cache'],
  ['.vite', 'vite cache'],
  ['.cache', 'tool cache'],
  ['dist', 'build output'],
  ['build', 'build output'],
  ['coverage', 'test coverage'],
  ['__pycache__', 'Python cache'],
  ['.pytest_cache', 'pytest cache'],
  ['.mypy_cache', 'mypy cache'],
  ['.venv', 'Python virtualenv'],
  ['venv', 'Python virtualenv'],
  ['target', 'Rust/Java build output'],
  ['.gradle', 'Gradle cache'],
  ['Pods', 'pod install'],
  ['DerivedData', 'Xcode build'],
]);

// Returns the rebuildable folder name if any folder in the path is one.
// A path that *is* such a folder (e.g. "app/node_modules") also counts.
export function rebuildableKind(relPath: string, isDir = false): string | null {
  const segments = relPath.split('/');
  const last = isDir ? segments.length : segments.length - 1;
  for (let i = 0; i < last; i++) if (REBUILDABLE.has(segments[i])) return segments[i];
  return null;
}
