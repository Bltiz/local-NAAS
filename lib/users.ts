import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { systemDir } from '@/lib/storage';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Access = 'all' | 'home';

export interface User {
  id: string;
  name: string;
  passwordHash: string;
  access: Access;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  access: Access;
  home: string | null;
  createdAt: string;
}

export const USERS_ROOT = 'Users';

const g = globalThis as unknown as { __nasUsers?: User[] | null };
const usersFile = () => join(systemDir(), 'users.json');

async function load(): Promise<User[]> {
  if (g.__nasUsers) return g.__nasUsers;
  try {
    g.__nasUsers = JSON.parse(await readFile(usersFile(), 'utf8')) as User[];
  } catch {
    g.__nasUsers = [];
  }
  return g.__nasUsers;
}

async function save(users: User[]) {
  g.__nasUsers = users;
  await mkdir(systemDir(), { recursive: true });
  await writeFile(usersFile(), JSON.stringify(users, null, 2));
}

export const homeOf = (user: Pick<User, 'name' | 'access'>) => (user.access === 'home' ? `${USERS_ROOT}/${user.name}` : null);

export const toPublic = (u: User): PublicUser => ({ id: u.id, name: u.name, access: u.access, home: homeOf(u), createdAt: u.createdAt });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export class UserError extends Error {}

function cleanName(name: string): string {
  const n = String(name ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(n)) throw new UserError('Usernames are 2–32 letters, numbers, dots, dashes or underscores.');
  if (n === 'admin') throw new UserError('“admin” is reserved for the main password.');
  return n;
}

function checkPassword(password: string) {
  if (typeof password !== 'string' || password.length < 8) throw new UserError('Passwords need at least 8 characters.');
}

export async function listUsers(): Promise<PublicUser[]> {
  return (await load()).map(toPublic);
}

export async function findUser(id: string): Promise<User | null> {
  return (await load()).find((u) => u.id === id) ?? null;
}

export async function createUser(input: { name: string; password: string; access: Access }): Promise<PublicUser> {
  const users = await load();
  const name = cleanName(input.name);
  checkPassword(input.password);
  if (users.some((u) => u.name === name)) throw new UserError('That username is taken.');
  const user: User = {
    id: randomBytes(8).toString('hex'),
    name,
    passwordHash: await hashPassword(input.password),
    access: input.access === 'all' ? 'all' : 'home',
    createdAt: new Date().toISOString(),
  };
  await save([...users, user]);
  return toPublic(user);
}

export async function updateUser(id: string, patch: { password?: string; access?: Access }): Promise<PublicUser> {
  const users = await load();
  const user = users.find((u) => u.id === id);
  if (!user) throw new UserError('User not found.');
  if (patch.password !== undefined) {
    checkPassword(patch.password);
    user.passwordHash = await hashPassword(patch.password);
  }
  if (patch.access === 'all' || patch.access === 'home') user.access = patch.access;
  await save(users);
  return toPublic(user);
}

export async function deleteUser(id: string): Promise<void> {
  const users = await load();
  await save(users.filter((u) => u.id !== id));
}

export async function authenticateUser(name: string, password: string): Promise<User | null> {
  const n = String(name ?? '').trim().toLowerCase();
  const user = (await load()).find((u) => u.name === n);
  if (!user) {
    // Spend comparable time so response timing doesn't reveal which usernames exist.
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}
