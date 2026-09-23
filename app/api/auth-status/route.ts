import { NextRequest, NextResponse } from 'next/server';
import { getAuthMode } from '@/lib/auth';
import { listUsers } from '@/lib/users';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const viewer = await getViewer(request);
  const mode = getAuthMode();
  return NextResponse.json({
    mode,
    authenticated: viewer !== null,
    viewer,
    hasUsers: mode === 'protected' ? (await listUsers()).length > 0 : false,
  });
}
