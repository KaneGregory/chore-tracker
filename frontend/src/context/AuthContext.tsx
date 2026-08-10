import { createContext, useContext } from 'react';
import type { AuthState } from './authReducer';
import type { LoginRequest, RegisterRequest } from '../types/auth';

export interface AuthContextValue {
  state: AuthState;
  register: (input: RegisterRequest) => Promise<void>;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  // Re-reads the current session, e.g. after joining/creating a household from the
  // onboarding screen, or to check whether a pending application has been resolved.
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
