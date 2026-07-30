'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth';
import { apiFetch, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await apiFetch<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      login(data.token);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Sign in</h1>
          <p className="mt-1 text-sm text-gray-400">
            Enterprise RBAC &amp; Tokenization Marketplace
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />

            {error && (
              <p className="rounded-md border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-600">
          Session is in-memory — you will be signed out on page refresh.
        </p>
      </div>
    </div>
  );
}
