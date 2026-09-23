import { NextRequest, NextResponse } from 'next/server';
import { getStorageAdapter } from '@/lib/storage';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filename = searchParams.get('file');

    if (!filename) {
      return NextResponse.json({ error: 'Filename required' }, { status: 400 });
    }

    const storage = getStorageAdapter();

    // For S3, redirect to presigned URL
    if (process.env.USE_S3 === 'true') {
      const url = await storage.getDownloadUrl(filename);
      return NextResponse.redirect(url);
    }

    // For local storage, serve the file directly
    const fileBuffer = await storage.download(filename);

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/octet-stream',
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
