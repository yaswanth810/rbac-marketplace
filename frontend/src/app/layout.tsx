import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/contexts/auth';

export const metadata: Metadata = {
  title: {
    default: 'Enterprise RBAC & Tokenization Marketplace',
    template: '%s | RBAC Marketplace',
  },
  description:
    'Secure role-based access control and asset tokenization platform for enterprise use.',
  keywords: ['RBAC', 'tokenization', 'marketplace', 'enterprise', 'blockchain'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
