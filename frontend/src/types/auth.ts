export type HouseholdRole = 'member' | 'head';

export interface User {
  id: number;
  email: string;
}

export interface Household {
  id: number;
  name: string;
  joinCode: string;
  role: HouseholdRole;
}

export interface HouseholdMember {
  id: number;
  email: string;
  role: HouseholdRole;
}

export type HouseholdChoice = { mode: 'create'; name: string } | { mode: 'join'; joinCode: string };

export interface RegisterRequest {
  email: string;
  password: string;
  household: HouseholdChoice;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  households: Household[];
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}
