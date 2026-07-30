'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth';

/**
 * Root page — redirects to /dashboard if authenticated, otherwise /login.
 * JWT lives in React Context; on first load (or after refresh) token is null,
 * so the user is always sent to /login on page load.
 */
export default function RootPage() {
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (token) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [token, router]);

  return null;
}
