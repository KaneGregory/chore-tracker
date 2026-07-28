import { apiRequest } from './httpClient';
import type { HouseholdMember } from '../types/auth';

interface MembersResponse {
  members: HouseholdMember[];
}

export async function listMembers(householdId: number): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(`/api/households/${householdId}/members`);
  return response.members;
}

export async function promoteMember(
  householdId: number,
  userId: number,
): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(
    `/api/households/${householdId}/members/${userId}/promote`,
    { method: 'POST' },
  );
  return response.members;
}
