'use client';

import { useEffect, useState } from 'react';
import { HardDrive, Lock, Loader2, AlertTriangle, UserRound } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Mode = 'open' | 'protected' | 'misconfigured' | null;

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasUsers, setHasUsers] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<Mode>(null);

  useEffect(() => {
    fetch('/api/auth-status')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          window.location.replace('/');
        } else {
          setMode(data.mode);
          setHasUsers(Boolean(data.hasUsers));
        }
      })
      .catch(() => setMode('protected'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.replace('/');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Sign in failed');
      setPassword('');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm bg-slate-800/50 border-slate-700 backdrop-blur">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/20">
            <HardDrive className="h-6 w-6 text-purple-300" />
          </div>
          <CardTitle className="text-2xl text-white">Local NAS</CardTitle>
          <CardDescription className="text-slate-400">
            Enter your password to access your files
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : mode === 'misconfigured' ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                No password is set
              </p>
              <p className="mt-2 text-amber-200/80">
                This server is online but locked until you add a <code className="font-mono">NAS_PASSWORD</code>{' '}
                variable in your Railway service settings and redeploy.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {hasUsers && (
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    autoComplete="username"
                    autoCapitalize="none"
                    autoFocus
                    placeholder="Username (empty for admin)"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-10 pl-9 bg-slate-900/50 border-slate-700 text-white"
                  />
                </div>
              )}
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  type="password"
                  autoComplete="current-password"
                  autoFocus={!hasUsers}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(error)}
                  className="h-10 pl-9 bg-slate-900/50 border-slate-700 text-white"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={submitting || !password}
                className="h-10 w-full bg-purple-600 text-white hover:bg-purple-500"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
