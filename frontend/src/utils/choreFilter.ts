import type { Chore, ChoreFilter, ChoreStatus } from '../types/chore';
import { worstChoreStatus } from './choreStatus';

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
