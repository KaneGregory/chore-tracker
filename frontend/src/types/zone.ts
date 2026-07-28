export interface Zone {
  id: number;
  name: string;
  isRoot: boolean;
  children: Zone[];
}
