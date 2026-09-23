import { NextResponse } from 'next/server';
import { getStorageAdapter } from '@/lib/storage';

export async function GET() {
  try {
    const storage = getStorageAdapter();
    const files = await storage.list();

    return NextResponse.json({ files });
  } catch (error) {
    console.error('List files error:', error);
    return NextResponse.json({ files: [] });
  }
}
