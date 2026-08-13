import { apiRequest } from './httpClient';
import type { Schedule, ScheduleInput, ScheduleWithTarget } from '../types/schedule';

export async function listSchedules(householdId: number): Promise<ScheduleWithTarget[]> {
  const response = await apiRequest<{ schedules: ScheduleWithTarget[] }>(
    `/api/households/${householdId}/chores/schedules`,
  );
  return response.schedules;
}

export async function setChoreSchedule(
  householdId: number,
  choreId: number,
  input: ScheduleInput,
): Promise<Schedule> {
  const response = await apiRequest<{ schedule: Schedule }>(
    `/api/households/${householdId}/chores/${choreId}/schedule`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
  return response.schedule;
}

export async function removeChoreSchedule(householdId: number, choreId: number): Promise<void> {
  await apiRequest<void>(`/api/households/${householdId}/chores/${choreId}/schedule`, { method: 'DELETE' });
}

export async function setChoreZoneSchedule(
  householdId: number,
  choreId: number,
  zoneId: number,
  input: ScheduleInput,
): Promise<Schedule> {
  const response = await apiRequest<{ schedule: Schedule }>(
    `/api/households/${householdId}/chores/${choreId}/zones/${zoneId}/schedule`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
  return response.schedule;
}

export async function removeChoreZoneSchedule(
  householdId: number,
  choreId: number,
  zoneId: number,
): Promise<void> {
  await apiRequest<void>(
    `/api/households/${householdId}/chores/${choreId}/zones/${zoneId}/schedule`,
    { method: 'DELETE' },
  );
}
