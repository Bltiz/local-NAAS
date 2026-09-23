export const SESSION_COOKIE = 'nas_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type AuthMode = 'open' | 'protected' | 'misconfigured';

// Hosted deployments must set a password; local runs stay open unless one is set.
export function getAuthMode(): AuthMode {
  if (process.env.NAS_PASSWORD) return 'protected';
  const hosted = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PUBLIC_DOMAIN);
  return hosted ? 'misconfigured' : 'open';
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env.NAS_PASSWORD ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

// The admin token is derived from NAS_PASSWORD, so changing it signs everyone out.
export function sessionToken(): Promise<string> {
  return hmac('local-nas-session-v1');
}

// User tokens: "u.<id>.<version>.<sig>". The version changes with the user's
// password, so a password reset signs that user out everywhere.
export async function userToken(id: string, version: string): Promise<string> {
  return `u.${id}.${version}.${await hmac(`user:${id}:${version}`)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type TokenClaim = { kind: 'admin' } | { kind: 'user'; id: string; version: string };

// Checks the signature only; API routes additionally confirm the user still exists.
export async function verifyToken(cookieValue: string | undefined): Promise<TokenClaim | null> {
  const mode = getAuthMode();
  if (mode === 'open') return { kind: 'admin' };
  if (mode === 'misconfigured' || !cookieValue) return null;
  if (constantTimeEqual(cookieValue, await sessionToken())) return { kind: 'admin' };
  const parts = cookieValue.split('.');
  if (parts.length !== 4 || parts[0] !== 'u') return null;
  const [, id, version] = parts;
  return constantTimeEqual(cookieValue, await userToken(id, version)) ? { kind: 'user', id, version } : null;
}

export async function checkPassword(attempt: string): Promise<boolean> {
  const password = process.env.NAS_PASSWORD;
  if (!password) return false;
  const [a, b] = await Promise.all(
    [attempt, password].map(async (value) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))),
  );
  return constantTimeEqual(a, b);
}

export async function isAuthorized(request: { cookies: { get(name: string): { value: string } | undefined } }) {
  return (await verifyToken(request.cookies.get(SESSION_COOKIE)?.value)) !== null;
}
