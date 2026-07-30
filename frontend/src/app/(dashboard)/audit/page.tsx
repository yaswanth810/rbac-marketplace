'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner, ErrorMessage, EmptyState } from '@/components/ui/Spinner';

interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  organization_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

const ACTION_COLOUR: Record<string, 'green' | 'red' | 'yellow' | 'blue' | 'gray'> = {
  'asset.create': 'green',
  'asset.approve': 'blue',
  'asset.reject': 'red',
  'asset.submit': 'yellow',
  'token.deploy': 'blue',
  'token.mint': 'blue',
  'token.configure': 'yellow',
  'marketplace.create': 'green',
  'marketplace.publish': 'green',
  'investment.create': 'green',
  'investment.confirmed': 'green',
  'investment.payment_captured': 'yellow',
};

export default function AuditPage() {
  const api = useApi();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AuditLog[]>('/api/audit')
      .then(setLogs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-white">Audit Log</h1>
      <p className="mb-4 text-sm text-gray-400">Showing the 100 most recent events.</p>

      {loading && <PageSpinner />}
      {error && <ErrorMessage message={error} />}
      {!loading && !error && logs.length === 0 && (
        <EmptyState message="No audit log entries found." />
      )}

      {!loading && !error && logs.length > 0 && (
        <Card padding={false}>
          <table className="min-w-full divide-y divide-gray-700 text-xs">
            <thead>
              <tr>
                {['Time', 'Action', 'Resource', 'User', 'Details'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-medium uppercase tracking-wider text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-700/20">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ACTION_COLOUR[log.action] ?? 'gray'}>
                      {log.action}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    <span className="capitalize">{log.resource_type}</span>
                    {log.resource_id && (
                      <span className="ml-1 text-gray-600">{log.resource_id.slice(0, 8)}…</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {log.user_id ? `${log.user_id.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    {log.new_state && (
                      <details className="cursor-pointer">
                        <summary className="text-indigo-400 hover:text-indigo-300">
                          new_state
                        </summary>
                        <pre className="mt-1 overflow-auto rounded bg-gray-900 p-2 text-gray-300 text-xs">
                          {JSON.stringify(log.new_state, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
