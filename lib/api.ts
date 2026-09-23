import { NextRequest, NextResponse } from 'next/server';
import { StorageError } from '@/lib/storage';
import { type Viewer, getViewer } from '@/lib/viewer';

type Handler = (request: NextRequest, viewer: Viewer) => Promise<Response>;

// Wraps a route handler with the session check and StorageError -> JSON mapping.
export function protectedRoute(handler: Handler) {
  return async (request: NextRequest): Promise<Response> => {
    const viewer = await getViewer(request);
    if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
      return await handler(request, viewer);
    } catch (error) {
      if (error instanceof StorageError) {
        return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
      }
      console.error(error);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  };
}
