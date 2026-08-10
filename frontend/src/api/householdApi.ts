import { apiRequest } from './httpClient';
import type { Household, HouseholdChoice, HouseholdMember } from '../types/auth';

interface MembersResponse {
  members: HouseholdMember[];
}

export async function listMembers(householdId: number): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(`/api/households/${householdId}/members`);
  return response.members;
}

export async function createMember(
  householdId: number,
  username: string,
): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(`/api/households/${householdId}/members`, {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
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

export async function demoteMember(
  householdId: number,
  userId: number,
): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(
    `/api/households/${householdId}/members/${userId}/demote`,
    { method: 'POST' },
  );
  return response.members;
}

export async function approveMember(
  householdId: number,
  userId: number,
): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(
    `/api/households/${householdId}/members/${userId}/approve`,
    { method: 'POST' },
  );
  return response.members;
}

export async function declineMember(
  householdId: number,
  userId: number,
): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(
    `/api/households/${householdId}/members/${userId}/decline`,
    { method: 'POST' },
  );
  return response.members;
}

export async function assignPendingMember(
  householdId: number,
  userId: number,
  targetMemberId: number,
): Promise<HouseholdMember[]> {
  const response = await apiRequest<MembersResponse>(
    `/api/households/${householdId}/members/${userId}/assign`,
    { method: 'POST', body: JSON.stringify({ targetMemberId }) },
  );
  return response.members;
}

export async function createOrJoinHousehold(choice: HouseholdChoice): Promise<Household> {
  const response = await apiRequest<{ household: Household }>('/api/households', {
    method: 'POST',
    body: JSON.stringify(choice),
  });
  return response.household;
}
