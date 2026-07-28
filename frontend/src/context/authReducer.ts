import type { Household, User } from '../types/auth';

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User; households: Household[] }
  | { status: 'unauthenticated' };

export type AuthAction =
  | { type: 'SESSION_CHECK_COMPLETE'; user: User | null; households: Household[] }
  | { type: 'LOGIN_SUCCESS'; user: User; households: Household[] }
  | { type: 'LOGOUT' };

export const initialAuthState: AuthState = { status: 'loading' };

export function authReducer(_state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SESSION_CHECK_COMPLETE':
      return action.user
        ? { status: 'authenticated', user: action.user, households: action.households }
        : { status: 'unauthenticated' };
    case 'LOGIN_SUCCESS':
      return { status: 'authenticated', user: action.user, households: action.households };
    case 'LOGOUT':
      return { status: 'unauthenticated' };
  }
}
