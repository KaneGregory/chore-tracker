export type HouseholdRole = 'member' | 'head';

// 'pending' means an applicant who joined via code but hasn't been approved,
// assigned, or declined by a Head of Household yet — see MembersList/MembersPage.
export type HouseholdMemberStatus = 'pending' | 'active';

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
  status: HouseholdMemberStatus;
}

export interface HouseholdMember {
  id: number;
  username: string;
  role: HouseholdRole;
  status: HouseholdMemberStatus;
  // The person who originally created the household — permanently immune to demotion.
  isCreator: boolean;
  // Whether this member can log in as themselves — false for a member a Head of
  // Household created directly rather than approving a join.
  hasAccount: boolean;
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
