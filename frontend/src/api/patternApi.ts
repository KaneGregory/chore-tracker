import { apiRequest } from './httpClient';
import type { CreatePatternInput, RenamePatternInput, SchedulePattern } from '../types/pattern';

export async function listPatterns(householdId: number): Promise<SchedulePattern[]> {
  const response = await apiRequest<{ patterns: SchedulePattern[] }>(
    `/api/households/${householdId}/patterns`,
  );
  return response.patterns;
}

export async function createPattern(
  householdId: number,
  input: CreatePatternInput,
): Promise<SchedulePattern> {
  const response = await apiRequest<{ pattern: SchedulePattern }>(
    `/api/households/${householdId}/patterns`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.pattern;
}

export async function renamePattern(
  householdId: number,
  patternId: number,
  input: RenamePatternInput,
): Promise<SchedulePattern> {
  const response = await apiRequest<{ pattern: SchedulePattern }>(
    `/api/households/${householdId}/patterns/${patternId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.pattern;
}

export async function removePattern(householdId: number, patternId: number): Promise<void> {
  await apiRequest<void>(`/api/households/${householdId}/patterns/${patternId}`, {
    method: 'DELETE',
  });
}
