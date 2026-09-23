import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { writeFile, readFile, unlink, readdir, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { basename, join } from 'path';

// Strips directory components so names like "../secret" can't escape the upload dir.
function safeName(filename: string): string {
  const name = basename(filename);
  if (!name || name === '.' || name === '..') {
    throw new Error('Invalid filename');
  }
  return name;
}

export interface FileInfo {
  name: string;
  size: number;
  uploadedAt: string;
}

export interface StorageAdapter {
  upload(file: File): Promise<void>;
  download(filename: string): Promise<Buffer>;
  delete(filename: string): Promise<void>;
  list(): Promise<FileInfo[]>;
  getDownloadUrl(filename: string): Promise<string>;
}

// Local file system storage
class LocalStorage implements StorageAdapter {
  private uploadDir: string;

  constructor() {
    this.uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  }

  async upload(file: File): Promise<void> {
    if (!existsSync(this.uploadDir)) {
      await mkdir(this.uploadDir, { recursive: true });
    }
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filePath = join(this.uploadDir, safeName(file.name));
    await writeFile(filePath, buffer);
  }

  async download(filename: string): Promise<Buffer> {
    const filePath = join(this.uploadDir, safeName(filename));
    return await readFile(filePath);
  }

  async delete(filename: string): Promise<void> {
    const filePath = join(this.uploadDir, safeName(filename));
    await unlink(filePath);
  }

  async list(): Promise<FileInfo[]> {
    if (!existsSync(this.uploadDir)) {
      return [];
    }

    const fileNames = await readdir(this.uploadDir);
    
    const filesWithDetails = await Promise.all(
      fileNames.filter((name) => !name.startsWith('.')).map(async (name) => {
        const filePath = join(this.uploadDir, name);
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

    return filesWithDetails;
  }

  async getDownloadUrl(filename: string): Promise<string> {
    return `/api/download?file=${encodeURIComponent(filename)}`;
  }
}

// S3 storage for Railway/cloud deployment
class S3Storage implements StorageAdapter {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET_NAME || '';
    
    this.s3Client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async upload(file: File): Promise<void> {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: file.name,
      Body: buffer,
      ContentType: file.type,
      Metadata: {
        uploadedAt: new Date().toISOString(),
        originalSize: file.size.toString(),
      },
    });

    await this.s3Client.send(command);
  }

  async download(filename: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: filename,
    });

    const response = await this.s3Client.send(command);
    const stream = response.Body as any;
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async delete(filename: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: filename,
    });

    await this.s3Client.send(command);
  }

  async list(): Promise<FileInfo[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
    });

    const response = await this.s3Client.send(command);
    
    if (!response.Contents) {
      return [];
    }

    const files = response.Contents.map((obj) => ({
      name: obj.Key || '',
      size: obj.Size || 0,
      uploadedAt: obj.LastModified?.toISOString() || new Date().toISOString(),
    }));

    files.sort((a, b) => 
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    return files;
  }

  async getDownloadUrl(filename: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: filename,
    });

    // Generate a presigned URL valid for 1 hour
    return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }
}

// Factory function to get the appropriate storage adapter
export function getStorageAdapter(): StorageAdapter {
  const useS3 = process.env.USE_S3 === 'true' && 
                process.env.S3_BUCKET_NAME && 
                process.env.S3_ACCESS_KEY_ID && 
                process.env.S3_SECRET_ACCESS_KEY;

  if (useS3) {
    console.log('Using S3 storage');
    return new S3Storage();
  } else {
    console.log('Using local file storage');
    return new LocalStorage();
  }
}
