import { NextResponse } from 'next/server';
import { getAuthMode } from '@/lib/auth';
import { protectedRoute } from '@/lib/api';
import { makeFolder } from '@/lib/storage';
import { UserError, createUser, deleteUser, listUsers, updateUser } from '@/lib/users';
import { requireAdmin } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const fail = (error: unknown) => {
  if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
};

export const GET = protectedRoute(async (_request, viewer) => {
  requireAdmin(viewer);
  return NextResponse.json({ users: await listUsers(), enabled: getAuthMode() === 'protected' });
});

export const POST = protectedRoute(async (request, viewer) => {
  requireAdmin(viewer);
  if (getAuthMode() !== 'protected') {
    return NextResponse.json({ error: 'Set a main password (NAS_PASSWORD) before adding users.' }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const user = await createUser({ name: body.name, password: body.password, access: body.access });
    if (user.home) await makeFolder(user.home);
    return NextResponse.json({ user });
  } catch (error) {
    return fail(error);
  }
});

export const PATCH = protectedRoute(async (request, viewer) => {
  requireAdmin(viewer);
  const body = await request.json().catch(() => ({}));
  try {
    const user = await updateUser(String(body.id ?? ''), { password: body.password, access: body.access });
    if (user.home) await makeFolder(user.home);
    return NextResponse.json({ user });
  } catch (error) {
    return fail(error);
  }
});

export const DELETE = protectedRoute(async (request, viewer) => {
  requireAdmin(viewer);
  await deleteUser(request.nextUrl.searchParams.get('id') ?? '');
  return NextResponse.json({ success: true });
});
