import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { choreAssignments, chores, choreZones, users, zones } from '../db/schema.js';
import type { ChoreStatus } from '../db/schema.js';
import {
  CannotAssignOthersError,
  CannotUnassignOthersError,
  ChoreAlreadyAssignedError,
  ChoreAssignmentNotFoundError,
  ChoreNotFoundError,
  ChoreStatusManagedByZonesError,
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

export interface ChoreZoneStatus {
  zoneId: number;
  status: ChoreStatus;
}

export interface ChoreSummary {
  id: number;
  name: string;
  status: ChoreStatus;
  zones: ChoreZoneStatus[];
  assignments: ChoreAssignmentSummary[];
}

type ChoreRow = { id: number; name: string; status: ChoreStatus };

const CHORE_ROW_COLUMNS = {
  id: chores.id,
  name: chores.name,
  status: chores.status,
};

// Lowest-to-highest: overdue is the worst outstanding state, complete the best. A
// chore with zones takes the lowest (worst) of its zones' statuses, per the rule that
// a chore isn't done until every one of its zones is.
const STATUS_RANK: Record<ChoreStatus, number> = { overdue: 0, 'to-do': 1, complete: 2 };

function deriveChoreStatus(ownStatus: ChoreStatus, zoneStatuses: ChoreStatus[]): ChoreStatus {
  if (zoneStatuses.length === 0) return ownStatus;
  return zoneStatuses.reduce((lowest, status) =>
    STATUS_RANK[status] < STATUS_RANK[lowest] ? status : lowest,
  );
}

function findChoreInHousehold(householdId: number, choreId: number): ChoreRow | undefined {
  return db
    .select(CHORE_ROW_COLUMNS)
    .from(chores)
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .get();
}

function attachDetails(choreRows: ChoreRow[]): ChoreSummary[] {
  if (choreRows.length === 0) return [];

  const choreIds = choreRows.map((row) => row.id);

  const zoneLinks = db
    .select({ choreId: choreZones.choreId, zoneId: choreZones.zoneId, status: choreZones.status })
    .from(choreZones)
    .where(inArray(choreZones.choreId, choreIds))
    .all();

  const zonesByChore = new Map<number, ChoreZoneStatus[]>();
  for (const link of zoneLinks) {
    const list = zonesByChore.get(link.choreId) ?? [];
    list.push({ zoneId: link.zoneId, status: link.status });
    zonesByChore.set(link.choreId, list);
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

  return choreRows.map((row) => {
    const zones = zonesByChore.get(row.id) ?? [];
    return {
      id: row.id,
      name: row.name,
      status: deriveChoreStatus(
        row.status,
        zones.map((zone) => zone.status),
      ),
      zones,
      assignments: assignmentsByChore.get(row.id) ?? [],
    };
  });
}

// attachDetails is written for the list case; this re-attaches details to a single
// already-fetched chore row, which always yields exactly one result.
function attachDetailsToOne(choreRow: ChoreRow): ChoreSummary {
  return attachDetails([choreRow])[0]!;
}

export function listChoresForRequester(
  householdId: number,
  requestingUserId: number,
): ChoreSummary[] {
  requireMembership(householdId, requestingUserId);

  const rows = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.householdId, householdId)).all();

  return attachDetails(rows);
}

export function createChore(
  householdId: number,
  requestingUserId: number,
  name: string,
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
      .values({ householdId, name, createdAt: now })
      .returning()
      .get();

    if (uniqueZoneIds.length > 0) {
      tx.insert(choreZones)
        .values(uniqueZoneIds.map((zoneId) => ({ choreId: inserted.id, zoneId })))
        .run();
    }

    return inserted;
  });

  return attachDetailsToOne(chore);
}

export function removeChore(
  householdId: number,
  requestingUserId: number,
  choreId: number,
): ChoreSummary[] {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  // Relies on chore_zones' and chore_assignments' ON DELETE CASCADE (both FK to
  // chores.id) to clean up the chore's zone links and assignments in the same
  // statement.
  db.delete(chores).where(eq(chores.id, choreId)).run();

  const rows = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.householdId, householdId)).all();
  return attachDetails(rows);
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

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

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

export function unassignChore(
  householdId: number,
  choreId: number,
  requestingUserId: number,
  assignmentId: number,
): ChoreSummary {
  const requesterRole = requireMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const assignment = db
    .select({ id: choreAssignments.id, userId: choreAssignments.userId })
    .from(choreAssignments)
    .where(and(eq(choreAssignments.id, assignmentId), eq(choreAssignments.choreId, choreId)))
    .get();
  if (!assignment) throw new ChoreAssignmentNotFoundError();

  if (requesterRole !== 'head' && assignment.userId !== requestingUserId) {
    throw new CannotUnassignOthersError();
  }

  db.delete(choreAssignments).where(eq(choreAssignments.id, assignmentId)).run();

  return attachDetailsToOne(chore);
}

export function setChoreStatus(
  householdId: number,
  choreId: number,
  requestingUserId: number,
  status: 'to-do' | 'complete',
): ChoreSummary {
  requireMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const anyZoneLink = db
    .select({ id: choreZones.id })
    .from(choreZones)
    .where(eq(choreZones.choreId, choreId))
    .get();
  if (anyZoneLink) throw new ChoreStatusManagedByZonesError();

  db.update(chores).set({ status }).where(eq(chores.id, choreId)).run();

  return attachDetailsToOne({ ...chore, status });
}

export function setChoreZoneStatus(
  householdId: number,
  choreId: number,
  zoneId: number,
  requestingUserId: number,
  status: 'to-do' | 'complete',
): ChoreSummary {
  requireMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const link = db
    .select({ id: choreZones.id })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link) throw new ChoreZoneMismatchError();

  db.update(choreZones).set({ status }).where(eq(choreZones.id, link.id)).run();

  return attachDetailsToOne(chore);
}
