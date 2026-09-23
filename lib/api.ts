import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/auth';
import { StorageError } from '@/lib/storage';

type Handler = (request: NextRequest) => Promise<Response>;

// Wraps a route handler with the session check and StorageError -> JSON mapping.
export function protectedRoute(handler: Handler): Handler {
  return async (request) => {
    if (!(await isAuthorized(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof StorageError) {
        return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
      }
      console.error(error);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  };
}
