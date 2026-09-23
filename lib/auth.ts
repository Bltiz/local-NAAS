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

// The token is derived from the password, so changing NAS_PASSWORD signs everyone out.
export async function sessionToken(): Promise<string> {
  const password = process.env.NAS_PASSWORD ?? '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('local-nas-session-v1'));
  return toHex(signature);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  const mode = getAuthMode();
  if (mode === 'open') return true;
  if (mode === 'misconfigured' || !cookieValue) return false;
  return constantTimeEqual(cookieValue, await sessionToken());
}

export async function checkPassword(attempt: string): Promise<boolean> {
  const password = process.env.NAS_PASSWORD;
  if (!password) return false;
  const [a, b] = await Promise.all(
    [attempt, password].map(async (value) =>
      toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    ),
  );
  return constantTimeEqual(a, b);
}

export async function isAuthorized(request: { cookies: { get(name: string): { value: string } | undefined } }) {
  return isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
}
