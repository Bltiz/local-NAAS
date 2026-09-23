import { NextRequest, NextResponse } from 'next/server';
import { getAuthMode, isAuthorized } from '@/lib/auth';

export async function GET(request: NextRequest) {
  return NextResponse.json({
    mode: getAuthMode(),
    authenticated: await isAuthorized(request),
  });
}
