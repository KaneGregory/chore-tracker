export type ChoreType = 'single-time' | 'forever';

export interface ChoreAssignment {
  id: number;
  userId: number;
  userEmail: string;
  zoneId: number | null;
}

export interface Chore {
  id: number;
  name: string;
  type: ChoreType;
  zoneIds: number[];
  assignments: ChoreAssignment[];
}
