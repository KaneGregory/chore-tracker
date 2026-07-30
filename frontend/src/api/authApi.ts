import { apiRequest } from './httpClient';
import type { AuthResponse, LoginRequest, RegisterRequest } from '../types/auth';

export function register(input: RegisterRequest): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function login(input: LoginRequest): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<void> {
  return apiRequest<void>('/api/auth/logout', { method: 'POST' });
}

export function getMe(): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/auth/me');
}

export async function isEmailAvailable(email: string): Promise<boolean> {
  const response = await apiRequest<{ available: boolean }>(
    `/api/auth/email-availability?email=${encodeURIComponent(email)}`,
  );
  return response.available;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const response = await apiRequest<{ available: boolean }>(
    `/api/auth/username-availability?username=${encodeURIComponent(username)}`,
  );
  return response.available;
}
