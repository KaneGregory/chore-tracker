export interface User {
  id: number;
  email: string;
}

export interface Household {
  id: number;
  name: string;
  joinCode: string;
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
