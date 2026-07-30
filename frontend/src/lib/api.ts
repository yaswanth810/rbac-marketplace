'use client';

/**
 * lib/api.ts
 *
 * Thin fetch wrapper + useApi hook.
 *
 * useApi() returns pre-bound get/post/patch helpers that automatically
 * inject the Authorization header from AuthContext. All pages import
 * useApi() rather than calling fetch directly.
 *
 * Error shape from the backend:
 *   { statusCode: number; error: string; message: string }
 */

import { useAuth } from '@/contexts/auth';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

// ── API error ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

interface FetchOptions {
  method?: string;
  token?: string | null;
  body?: unknown;
  params?: Record<string, string | undefined | null>;
}

export async function apiFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { method = 'GET', token, body, params } = options;

  // Build query string from non-null params
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(
        ([, v]) => v != null && v !== '',
      ) as [string, string][],
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      message = data.message ?? message;
    } catch { /* ignore parse errors */ }
    throw new ApiError(res.status, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useApi() — returns get/post/patch helpers with the auth token pre-injected.
 * Use inside client components. For login (no token yet), call apiFetch directly.
 */
export function useApi() {
  const { token } = useAuth();

  return {
    get<T>(path: string, params?: Record<string, string | undefined | null>) {
      return apiFetch<T>(path, { token, params });
    },
    post<T>(path: string, body?: unknown) {
      return apiFetch<T>(path, { method: 'POST', token, body });
    },
    patch<T>(path: string, body?: unknown) {
      return apiFetch<T>(path, { method: 'PATCH', token, body });
    },
    del<T>(path: string) {
      return apiFetch<T>(path, { method: 'DELETE', token });
    },
  };
}
