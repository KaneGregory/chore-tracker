import type { ChoreStatus } from '../types/chore';

export const CHORE_STATUS_LABEL: Record<ChoreStatus, string> = {
  'to-do': 'To Do',
  complete: 'Complete',
  overdue: 'Overdue',
};

// Mirrors the backend's deriveChoreStatus ranking (backend/src/services/choreService.ts):
// a chore's status is the worst status among the zones being considered.
const STATUS_RANK: Record<ChoreStatus, number> = { overdue: 0, 'to-do': 1, complete: 2 };

export function worstChoreStatus(statuses: ChoreStatus[]): ChoreStatus {
  return statuses.reduce((worst, status) =>
    STATUS_RANK[status] < STATUS_RANK[worst] ? status : worst,
  );
}
