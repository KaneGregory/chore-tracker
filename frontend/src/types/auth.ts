export type HouseholdRole = 'member' | 'head';

export interface User {
  id: number;
  email: string;
  username: string;
}

export interface Household {
  id: number;
  name: string;
  joinCode: string;
  role: HouseholdRole;
}

export interface HouseholdMember {
  id: number;
  username: string;
  role: HouseholdRole;
  // The person who originally created the household — permanently immune to demotion.
  isCreator: boolean;
}

export type HouseholdChoice = { mode: 'create'; name: string } | { mode: 'join'; joinCode: string };

export interface RegisterRequest {
  email: string;
  username: string;
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
