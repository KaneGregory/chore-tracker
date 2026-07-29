export type ChoreType = 'single-time' | 'forever';

export interface Chore {
  id: number;
  name: string;
  type: ChoreType;
  zoneIds: number[];
}
