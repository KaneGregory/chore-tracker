import type { ChoreStatus } from '../types/chore';

export const CHORE_STATUS_LABEL: Record<ChoreStatus, string> = {
  'to-do': 'To Do',
  complete: 'Complete',
  overdue: 'Overdue',
};
