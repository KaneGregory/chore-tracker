import { useCallback, useEffect, useReducer, type ReactNode } from 'react';
import { AuthContext } from './AuthContext';
import { authReducer, initialAuthState } from './authReducer';
import * as authApi from '../api/authApi';
import type { LoginRequest, RegisterRequest } from '../types/auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  const refresh = useCallback(async () => {
    try {
      const response = await authApi.getMe();
      dispatch({
        type: 'SESSION_CHECK_COMPLETE',
        user: response.user,
        households: response.households,
      });
    } catch {
      dispatch({ type: 'SESSION_CHECK_COMPLETE', user: null, households: [] });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const register = useCallback(async (input: RegisterRequest) => {
    const response = await authApi.register(input);
    dispatch({ type: 'LOGIN_SUCCESS', user: response.user, households: response.households });
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    const response = await authApi.login(input);
    dispatch({ type: 'LOGIN_SUCCESS', user: response.user, households: response.households });
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <AuthContext.Provider value={{ state, register, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
