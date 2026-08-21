import type { Chore, ChoreStatus, ChoreZoneStatus } from '../types/chore';
import type { FilteredChore } from './choreFilter';
import { worstChoreStatus } from './choreStatus';

export interface ZoneChoreEntry {
  chore: Chore;
  zoneStatus: ChoreZoneStatus;
}

export interface ZoneBucket {
  zoneId: number;
  zoneName: string;
  // The worst status among the bucket's entries — mirrors how a zoned chore's own
  // card is tinted by the worst status among its zones (see choreFilter.ts).
  status: ChoreStatus;
  entries: ZoneChoreEntry[];
}

// Buckets already-filtered chores by zone for the "group by zone" view. A chore
// assigned to multiple zones repeats — once per zone it belongs to — rather than
// being deduplicated into a single bucket, per the flat-list-of-zones grouping
// design. zoneNameById is iterated (rather than sorted) so bucket order matches
// flattenZones's depth-first traversal order, which is how that map is built.
export function groupByZone(
  filtered: FilteredChore[],
  zoneNameById: Map<number, string>,
): { buckets: ZoneBucket[]; zoneless: FilteredChore[] } {
  const entriesByZoneId = new Map<number, ZoneChoreEntry[]>();
  const zoneless: FilteredChore[] = [];

  for (const filteredChore of filtered) {
    const { chore, visibleZoneIds } = filteredChore;
    if (chore.zones.length === 0) {
      zoneless.push(filteredChore);
      continue;
    }

    for (const zoneStatus of chore.zones) {
      if (visibleZoneIds !== null && !visibleZoneIds.includes(zoneStatus.zoneId)) continue;
      const entries = entriesByZoneId.get(zoneStatus.zoneId) ?? [];
      entries.push({ chore, zoneStatus });
      entriesByZoneId.set(zoneStatus.zoneId, entries);
    }
  }

  const buckets: ZoneBucket[] = [];
  for (const [zoneId, zoneName] of zoneNameById) {
    const entries = entriesByZoneId.get(zoneId);
    if (entries && entries.length > 0) {
      const status = worstChoreStatus(entries.map((entry) => entry.zoneStatus.status));
      buckets.push({ zoneId, zoneName, status, entries });
    }
  }

  return { buckets, zoneless };
}
