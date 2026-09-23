import { createHash } from 'crypto';
import { SESSION_COOKIE, verifyToken } from '@/lib/auth';
import { StorageError, normalizeRelPath } from '@/lib/storage';
import { type User, findUser, homeOf } from '@/lib/users';

export interface Viewer {
  id: string;
  name: string;
  role: 'admin' | 'member';
  // Restricted users only see this folder, presented to them as the root.
  home: string | null;
}

export const ADMIN: Viewer = { id: 'admin', name: 'admin', role: 'admin', home: null };

export const credentialVersion = (user: User) => createHash('sha256').update(user.passwordHash).digest('hex').slice(0, 12);

export async function getViewer(request: { cookies: { get(name: string): { value: string } | undefined } }): Promise<Viewer | null> {
  const claim = await verifyToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!claim) return null;
  if (claim.kind === 'admin') return ADMIN;
  const user = await findUser(claim.id);
  if (!user || credentialVersion(user) !== claim.version) return null;
  return { id: user.id, name: user.name, role: 'member', home: homeOf(user) };
}

// Maps paths between what a viewer sees and where files really are.
export function scope(viewer: Viewer) {
  const home = viewer.home;
  return {
    home,
    toReal(userPath: string | null | undefined): string {
      const rel = normalizeRelPath(userPath);
      return home ? `${home}/${rel}` : rel;
    },
    toUser(realPath: string): string | null {
      if (!home) return realPath;
      return realPath.startsWith(`${home}/`) ? realPath.slice(home.length + 1) : null;
    },
    contains(realPath: string): boolean {
      return !home || realPath.startsWith(`${home}/`);
    },
  };
}

export function requireAdmin(viewer: Viewer) {
  if (viewer.role !== 'admin') throw new StorageError('Only the admin can do that', 403);
}
