import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chores, choreZones, zones } from '../db/schema.js';
import type { ChoreType } from '../db/schema.js';
import { ZoneNotFoundError } from '../errors.js';
import { requireHeadMembership, requireMembership } from './membershipAuth.js';

export interface ChoreSummary {
  id: number;
  name: string;
  type: ChoreType;
  zoneIds: number[];
}

function attachZoneIds(choreRows: { id: number; name: string; type: ChoreType }[]): ChoreSummary[] {
  if (choreRows.length === 0) return [];

  const choreIds = choreRows.map((row) => row.id);
  const links = db
    .select({ choreId: choreZones.choreId, zoneId: choreZones.zoneId })
    .from(choreZones)
    .where(inArray(choreZones.choreId, choreIds))
    .all();

  const zoneIdsByChore = new Map<number, number[]>();
  for (const link of links) {
    const ids = zoneIdsByChore.get(link.choreId) ?? [];
    ids.push(link.zoneId);
    zoneIdsByChore.set(link.choreId, ids);
  }

  return choreRows.map((row) => ({ ...row, zoneIds: zoneIdsByChore.get(row.id) ?? [] }));
}

export function listChoresForRequester(
  householdId: number,
  requestingUserId: number,
): ChoreSummary[] {
  requireMembership(householdId, requestingUserId);

  const rows = db
    .select({ id: chores.id, name: chores.name, type: chores.type })
    .from(chores)
    .where(eq(chores.householdId, householdId))
    .all();

  return attachZoneIds(rows);
}

export function createChore(
  householdId: number,
  requestingUserId: number,
  name: string,
  type: ChoreType,
  zoneIds: number[],
): ChoreSummary {
  requireHeadMembership(householdId, requestingUserId);

  const uniqueZoneIds = [...new Set(zoneIds)];
  if (uniqueZoneIds.length > 0) {
    const validZones = db
      .select({ id: zones.id })
      .from(zones)
      .where(and(eq(zones.householdId, householdId), inArray(zones.id, uniqueZoneIds)))
      .all();
    if (validZones.length !== uniqueZoneIds.length) throw new ZoneNotFoundError();
  }

  const now = Date.now();
  const chore = db.transaction((tx) => {
    const inserted = tx
      .insert(chores)
      .values({ householdId, name, type, createdAt: now })
      .returning()
      .get();

    if (uniqueZoneIds.length > 0) {
      tx.insert(choreZones)
        .values(uniqueZoneIds.map((zoneId) => ({ choreId: inserted.id, zoneId })))
        .run();
    }

    return inserted;
  });

  return { id: chore.id, name: chore.name, type: chore.type, zoneIds: uniqueZoneIds };
}
