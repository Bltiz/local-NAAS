'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, HardDrive, Wifi, Trash2, File, LogOut } from 'lucide-react';

function redirectIfSignedOut(status: number): boolean {
  if (status === 401) {
    window.location.replace('/login');
    return true;
  }
  return false;
}

interface FileItem {
  name: string;
  size: number;
  uploadedAt: string;
}

export default function Home() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [serverAddress, setServerAddress] = useState('');
  const [passwordProtected, setPasswordProtected] = useState(false);

  const handleSignOut = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.replace('/login');
  };

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      if (redirectIfSignedOut(res.status)) return;
      const data = await res.json();
      setFiles(data.files || []);
    } catch (error) {
      console.error('Failed to fetch files:', error);
    }
  };

  useEffect(() => {
    fetch('/api/files')
      .then((res) => (redirectIfSignedOut(res.status) ? null : res.json()))
      .then((data) => data && setFiles(data.files || []))
      .catch((error) => console.error('Failed to fetch files:', error));
    fetch('/api/server-info')
      .then((res) => (redirectIfSignedOut(res.status) ? null : res.json()))
      .then((data) => data && setServerAddress(data.address))
      .catch((error) => console.error('Failed to fetch server address:', error));
    fetch('/api/auth-status')
      .then((res) => res.json())
      .then((data) => setPasswordProtected(data.mode === 'protected'))
      .catch(() => {});
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    Array.from(fileList).forEach((file) => {
      formData.append('files', file);
    });

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100;
          setUploadProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (redirectIfSignedOut(xhr.status)) return;
        if (xhr.status === 200) {
          fetchFiles();
          setUploadProgress(100);
          setTimeout(() => {
            setUploading(false);
            setUploadProgress(0);
          }, 1000);
        } else {
          setUploading(false);
          setUploadProgress(0);
        }
      });
      xhr.addEventListener('error', () => {
        setUploading(false);
        setUploadProgress(0);
      });

      xhr.open('POST', '/api/upload');
      xhr.send(formData);
    } catch (error) {
      console.error('Upload failed:', error);
      setUploading(false);
    }
  }, []);

  const handleDownload = async (filename: string) => {
    window.open(`/api/download?file=${encodeURIComponent(filename)}`, '_blank');
  };

  const handleDelete = async (filename: string) => {
    try {
      const res = await fetch('/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (redirectIfSignedOut(res.status)) return;
      fetchFiles();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {passwordProtected && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSignOut}
              className="border-slate-600 bg-slate-800/50 text-slate-200 hover:bg-slate-700 hover:text-white"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </Button>
          </div>
        )}
        <div className="text-center space-y-2">
          <h1 className="text-4xl md:text-6xl font-bold text-white flex items-center justify-center gap-3">
            <HardDrive className="w-10 h-10 md:w-14 md:h-14" />
            Local NAS
          </h1>
          <p className="text-slate-300 text-lg">Transfer files between your devices on the same network</p>
        </div>

        <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Wifi className="w-5 h-5" />
              Network Address
            </CardTitle>
            <CardDescription className="text-slate-400">
              Access this server from any device on your local network
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
              <code className="text-green-400 text-lg font-mono">
                {serverAddress || 'Loading...'}
              </code>
              <p className="text-slate-400 text-sm mt-2">
                Open this URL on your laptop or PC to access shared files
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Upload className="w-5 h-5" />
              Upload Files
            </CardTitle>
            <CardDescription className="text-slate-400">
              Upload files from this device to share across your network
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-600 rounded-lg cursor-pointer hover:border-purple-500 hover:bg-slate-800/50 transition-all"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 mb-3 text-slate-400" />
                  <p className="mb-2 text-sm text-slate-300">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-slate-400">Any file type supported</p>
                </div>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </label>

              {uploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-slate-300">
                    <span>Uploading...</span>
                    <span>{Math.round(uploadProgress)}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Download className="w-5 h-5" />
              Available Files
              <Badge variant="secondary" className="ml-2">
                {files.length}
              </Badge>
            </CardTitle>
            <CardDescription className="text-slate-400">
              Download or delete files from your network storage
            </CardDescription>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <File className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>No files uploaded yet</p>
                <p className="text-sm mt-2">Upload files to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-purple-500 transition-all"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <File className="w-5 h-5 text-purple-400 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{file.name}</p>
                        <p className="text-slate-400 text-sm">
                          {formatBytes(file.size)} • {new Date(file.uploadedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(file.name)}
                        className="border-slate-600 hover:bg-purple-500 hover:text-white"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(file.name)}
                        className="border-slate-600 hover:bg-red-500 hover:text-white"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-slate-400 text-sm">
          <p>Keep this server running to access files from other devices</p>
          <p className="mt-1">Files are stored in the uploads directory on this device</p>
        </div>
      </div>
    </div>
  );
}
