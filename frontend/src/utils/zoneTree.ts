import type { Zone } from '../types/zone';

export interface FlatZone {
  id: number;
  name: string;
}

export function flattenZones(zone: Zone): FlatZone[] {
  return [{ id: zone.id, name: zone.name }, ...zone.children.flatMap(flattenZones)];
}
