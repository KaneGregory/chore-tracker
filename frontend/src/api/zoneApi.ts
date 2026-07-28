import { apiRequest } from './httpClient';
import type { Zone } from '../types/zone';

interface ZoneTreeResponse {
  root: Zone;
}

export async function getZoneTree(householdId: number): Promise<Zone> {
  const response = await apiRequest<ZoneTreeResponse>(`/api/households/${householdId}/zones`);
  return response.root;
}

export async function createZone(
  householdId: number,
  name: string,
  parentZoneId: number,
): Promise<Zone> {
  const response = await apiRequest<ZoneTreeResponse>(`/api/households/${householdId}/zones`, {
    method: 'POST',
    body: JSON.stringify({ name, parentZoneId }),
  });
  return response.root;
}

export async function removeZone(householdId: number, zoneId: number): Promise<Zone> {
  const response = await apiRequest<ZoneTreeResponse>(
    `/api/households/${householdId}/zones/${zoneId}`,
    { method: 'DELETE' },
  );
  return response.root;
}

export async function moveZone(
  householdId: number,
  zoneId: number,
  newParentZoneId: number,
): Promise<Zone> {
  const response = await apiRequest<ZoneTreeResponse>(
    `/api/households/${householdId}/zones/${zoneId}`,
    { method: 'PATCH', body: JSON.stringify({ parentZoneId: newParentZoneId }) },
  );
  return response.root;
}
