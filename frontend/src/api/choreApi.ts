import { apiRequest } from './httpClient';
import type { Chore, ChoreType, SettableChoreStatus } from '../types/chore';

interface ChoresResponse {
  chores: Chore[];
}

export async function listChores(householdId: number): Promise<Chore[]> {
  const response = await apiRequest<ChoresResponse>(`/api/households/${householdId}/chores`);
  return response.chores;
}

export async function createChore(
  householdId: number,
  name: string,
  type: ChoreType,
  zoneIds: number[],
): Promise<Chore> {
  const response = await apiRequest<{ chore: Chore }>(`/api/households/${householdId}/chores`, {
    method: 'POST',
    body: JSON.stringify({ name, type, zoneIds }),
  });
  return response.chore;
}

export async function assignChore(
  householdId: number,
  choreId: number,
  userId: number,
  zoneId: number | null,
): Promise<Chore> {
  const response = await apiRequest<{ chore: Chore }>(
    `/api/households/${householdId}/chores/${choreId}/assignments`,
    { method: 'POST', body: JSON.stringify({ userId, zoneId }) },
  );
  return response.chore;
}

export async function unassignChore(
  householdId: number,
  choreId: number,
  assignmentId: number,
): Promise<Chore> {
  const response = await apiRequest<{ chore: Chore }>(
    `/api/households/${householdId}/chores/${choreId}/assignments/${assignmentId}`,
    { method: 'DELETE' },
  );
  return response.chore;
}

export async function setChoreStatus(
  householdId: number,
  choreId: number,
  status: SettableChoreStatus,
): Promise<Chore> {
  const response = await apiRequest<{ chore: Chore }>(
    `/api/households/${householdId}/chores/${choreId}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
  return response.chore;
}

export async function setChoreZoneStatus(
  householdId: number,
  choreId: number,
  zoneId: number,
  status: SettableChoreStatus,
): Promise<Chore> {
  const response = await apiRequest<{ chore: Chore }>(
    `/api/households/${householdId}/chores/${choreId}/zones/${zoneId}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
  return response.chore;
}
