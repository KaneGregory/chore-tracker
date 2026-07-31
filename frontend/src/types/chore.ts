// 'overdue' isn't settable yet — it'll be computed once due dates exist.
export type ChoreStatus = 'to-do' | 'complete' | 'overdue';
export type SettableChoreStatus = 'to-do' | 'complete';

export interface ChoreAssignment {
  id: number;
  userId: number;
  username: string;
  zoneId: number | null;
}

export interface ChoreZoneStatus {
  zoneId: number;
  status: ChoreStatus;
}

export interface Chore {
  id: number;
  name: string;
  status: ChoreStatus;
  zones: ChoreZoneStatus[];
  assignments: ChoreAssignment[];
}

// 'mine' resolves to the current user; a number filters to that specific member.
export type ChoreFilter = 'all' | 'mine' | number;
