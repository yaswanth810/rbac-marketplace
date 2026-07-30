'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth';
import { Sidebar } from '@/components/Sidebar';

/**
 * Dashboard shell layout — auth guard + sidebar.
 * All routes under (dashboard)/ inherit this layout.
 * If token is absent (not logged in / page refreshed), redirect to /login.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) router.replace('/login');
  }, [token, router]);

  // Prevent flash of authenticated content before redirect
  if (!token) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
