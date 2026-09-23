import { protectedRoute } from '@/lib/api';
import { serveFile } from '@/lib/serve';
import { scope } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async (request, viewer) => {
  const params = request.nextUrl.searchParams;
  return serveFile(request, scope(viewer).toReal(params.get('path')), params.get('inline') === '1');
});
