export type ChoreStatus = 'to-do' | 'complete' | 'overdue';
// 'overdue' is settable only by a Head of Household — enforced server-side, not here.
export type SettableChoreStatus = 'to-do' | 'complete' | 'overdue';

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
