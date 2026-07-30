'use client';

/**
 * contexts/auth.tsx
 *
 * JWT lives purely in React state — nothing persisted to localStorage or
 * sessionStorage per spec. A page refresh re-routes the user to /login.
 *
 * JWT payload shape (as issued by the backend):
 *   { userId, organizationId, permissions: string[], exp: number }
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from 'react';

// ── Payload type ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  organizationId: string;
  permissions: string[];
  exp: number;
}

// ── State & Actions ───────────────────────────────────────────────────────────

interface AuthState {
  token: string | null;
  user: JwtPayload | null;
}

type AuthAction =
  | { type: 'LOGIN'; token: string; user: JwtPayload }
  | { type: 'LOGOUT' };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN':
      return { token: action.token, user: action.user };
    case 'LOGOUT':
      return { token: null, user: null };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AuthContextValue extends AuthState {
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Decode JWT payload without verification (verification is server-side). */
function decodePayload(token: string): JwtPayload {
  try {
    const base64 = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as JwtPayload;
  } catch {
    throw new Error('Invalid JWT token');
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, { token: null, user: null });

  const login = useCallback((token: string) => {
    const user = decodePayload(token);
    dispatch({ type: 'LOGIN', token, user });
  }, []);

  const logout = useCallback(() => {
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
