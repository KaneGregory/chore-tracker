import type { Chore, ChoreFilter, ChoreStatus } from '../types/chore';
import { CHORE_STATUSES, worstChoreStatus } from './choreStatus';

export interface FilteredChore {
  chore: Chore;
  // null means show every zone (no filtering); otherwise, only these zone ids.
  visibleZoneIds: number[] | null;
  // The status to display given the filter — the chore's own status when every
  // zone is visible, or the worst status among just the visible zones otherwise.
  displayStatus: ChoreStatus;
}

export function filterChores(
  chores: Chore[],
  filter: ChoreFilter,
  currentUserId: number,
): FilteredChore[] {
  if (filter === 'all') {
    return chores.map((chore) => ({ chore, visibleZoneIds: null, displayStatus: chore.status }));
  }

  const targetUserId = filter === 'mine' ? currentUserId : filter;
  const result: FilteredChore[] = [];

  for (const chore of chores) {
    const assignedAtChoreLevel = chore.assignments.some(
      (assignment) => assignment.zoneId === null && assignment.userId === targetUserId,
    );
    if (assignedAtChoreLevel) {
      result.push({ chore, visibleZoneIds: null, displayStatus: chore.status });
      continue;
    }

    const visibleZones = chore.zones.filter((zone) =>
      chore.assignments.some(
        (assignment) => assignment.zoneId === zone.zoneId && assignment.userId === targetUserId,
      ),
    );
    if (visibleZones.length > 0) {
      result.push({
        chore,
        visibleZoneIds: visibleZones.map((zone) => zone.zoneId),
        displayStatus: worstChoreStatus(visibleZones.map((zone) => zone.status)),
      });
    }
  }

  return result;
}

// A second, independent narrowing pass over filterChores's output — composes with
// the assignee filter above by further shrinking visibleZoneIds, so a status-filtered
// zone is hidden through the same mechanism an assignee-filtered zone already is.
export function filterByStatus(
  filtered: FilteredChore[],
  statuses: ReadonlySet<ChoreStatus>,
): FilteredChore[] {
  if (statuses.size === CHORE_STATUSES.length) return filtered;

  const result: FilteredChore[] = [];
  for (const filteredChore of filtered) {
    const { chore, visibleZoneIds } = filteredChore;

    if (chore.zones.length === 0) {
      if (statuses.has(chore.status)) result.push(filteredChore);
      continue;
    }

    const candidateZones =
      visibleZoneIds === null
        ? chore.zones
        : chore.zones.filter((zone) => visibleZoneIds.includes(zone.zoneId));
    const matchedZones = candidateZones.filter((zone) => statuses.has(zone.status));
    if (matchedZones.length === 0) continue;

    result.push({
      chore,
      visibleZoneIds: matchedZones.map((zone) => zone.zoneId),
      displayStatus: worstChoreStatus(matchedZones.map((zone) => zone.status)),
    });
  }
  return result;
}
