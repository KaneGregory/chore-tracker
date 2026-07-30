import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { choreAssignments, chores, choreZones, users, zones } from '../db/schema.js';
import type { ChoreType } from '../db/schema.js';
import {
  CannotAssignOthersError,
  ChoreAlreadyAssignedError,
  ChoreNotAssignableError,
  ChoreNotFoundError,
  ChoreZoneMismatchError,
  MemberNotFoundError,
  ZoneNotFoundError,
} from '../errors.js';
import { getMembership, requireHeadMembership, requireMembership } from './membershipAuth.js';

export interface ChoreAssignmentSummary {
  id: number;
  userId: number;
  username: string;
  zoneId: number | null;
}

export interface ChoreSummary {
  id: number;
  name: string;
  type: ChoreType;
  zoneIds: number[];
  assignments: ChoreAssignmentSummary[];
}

function attachDetails(choreRows: { id: number; name: string; type: ChoreType }[]): ChoreSummary[] {
  if (choreRows.length === 0) return [];

  const choreIds = choreRows.map((row) => row.id);

  const zoneLinks = db
    .select({ choreId: choreZones.choreId, zoneId: choreZones.zoneId })
    .from(choreZones)
    .where(inArray(choreZones.choreId, choreIds))
    .all();

  const zoneIdsByChore = new Map<number, number[]>();
  for (const link of zoneLinks) {
    const ids = zoneIdsByChore.get(link.choreId) ?? [];
    ids.push(link.zoneId);
    zoneIdsByChore.set(link.choreId, ids);
  }

  const assignmentRows = db
    .select({
      id: choreAssignments.id,
      choreId: choreAssignments.choreId,
      zoneId: choreAssignments.zoneId,
      userId: choreAssignments.userId,
      username: users.username,
    })
    .from(choreAssignments)
    .innerJoin(users, eq(users.id, choreAssignments.userId))
    .where(inArray(choreAssignments.choreId, choreIds))
    .all();

  const assignmentsByChore = new Map<number, ChoreAssignmentSummary[]>();
  for (const row of assignmentRows) {
    const list = assignmentsByChore.get(row.choreId) ?? [];
    list.push({ id: row.id, userId: row.userId, username: row.username, zoneId: row.zoneId });
    assignmentsByChore.set(row.choreId, list);
  }

  return choreRows.map((row) => ({
    ...row,
    zoneIds: zoneIdsByChore.get(row.id) ?? [],
    assignments: assignmentsByChore.get(row.id) ?? [],
  }));
}

// attachDetails is written for the list case; this re-attaches details to a single
// already-fetched chore row, which always yields exactly one result.
function attachDetailsToOne(choreRow: { id: number; name: string; type: ChoreType }): ChoreSummary {
  return attachDetails([choreRow])[0]!;
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

  return attachDetails(rows);
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

  return attachDetailsToOne({ id: chore.id, name: chore.name, type: chore.type });
}

export function assignChore(
  householdId: number,
  choreId: number,
  requestingUserId: number,
  assigneeUserId: number,
  zoneId: number | null,
): ChoreSummary {
  const requesterRole = requireMembership(householdId, requestingUserId);
  if (requesterRole !== 'head' && assigneeUserId !== requestingUserId) {
    throw new CannotAssignOthersError();
  }

  const chore = db
    .select({ id: chores.id, name: chores.name, type: chores.type })
    .from(chores)
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .get();
  if (!chore) throw new ChoreNotFoundError();
  if (chore.type !== 'single-time') throw new ChoreNotAssignableError();

  if (assigneeUserId !== requestingUserId && !getMembership(householdId, assigneeUserId)) {
    throw new MemberNotFoundError();
  }

  if (zoneId !== null) {
    const link = db
      .select({ zoneId: choreZones.zoneId })
      .from(choreZones)
      .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
      .get();
    if (!link) throw new ChoreZoneMismatchError();
  }

  // Assignment is many-to-many: several people can share a chore/zone target, but
  // not the same person twice. "Same person, same target" is checked here rather
  // than with a DB unique constraint because SQLite treats every NULL as distinct in
  // a unique index, so unique(choreId, zoneId, userId) wouldn't stop the same person
  // being assigned twice to a whole-chore (zoneId IS NULL) target. better-sqlite3 is
  // synchronous and single-connection, so there's no interleaving between this check
  // and the insert below to race against.
  const now = Date.now();
  db.transaction((tx) => {
    const existing = tx
      .select({ id: choreAssignments.id })
      .from(choreAssignments)
      .where(
        zoneId === null
          ? and(
              eq(choreAssignments.choreId, choreId),
              isNull(choreAssignments.zoneId),
              eq(choreAssignments.userId, assigneeUserId),
            )
          : and(
              eq(choreAssignments.choreId, choreId),
              eq(choreAssignments.zoneId, zoneId),
              eq(choreAssignments.userId, assigneeUserId),
            ),
      )
      .get();
    if (existing) throw new ChoreAlreadyAssignedError();

    tx.insert(choreAssignments).values({ choreId, zoneId, userId: assigneeUserId, createdAt: now }).run();
  });

  return attachDetailsToOne(chore);
}
