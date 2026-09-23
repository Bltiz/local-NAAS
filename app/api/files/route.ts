import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export async function GET() {
  try {
    const uploadDir = join(process.cwd(), 'uploads');

    if (!existsSync(uploadDir)) {
      return NextResponse.json({ files: [] });
    }

    const fileNames = await readdir(uploadDir);
    
    const filesWithDetails = await Promise.all(
      fileNames.map(async (name) => {
        const filePath = join(uploadDir, name);
        const stats = await stat(filePath);
        
        return {
          name,
          size: stats.size,
          uploadedAt: stats.mtime.toISOString(),
        };
      })
    );

    filesWithDetails.sort((a, b) => 
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    return NextResponse.json({ files: filesWithDetails });
  } catch (error) {
    console.error('List files error:', error);
    return NextResponse.json({ files: [] });
  }
}
