import { and, eq, inArray, isNull, or } from 'drizzle-orm';
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
  NotHeadOfHouseholdError,
  ZoneNotFoundError,
} from '../errors.js';
import { getMembership, requireHeadMembership, requireMembership } from './membershipAuth.js';
import {
  queueAssignmentNotification,
  queueOverdueNotification,
  queueReopenedNotification,
} from './notificationBatcher.js';
import { refreshOverdueAtForTarget } from './scheduleService.js';

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

type QueueNotificationFn = (
  userId: number,
  choreId: number,
  zoneId: number | null,
  choreName: string,
) => void;

// Assignees to notify on a chore/zone status change: anyone assigned directly to
// that zone, plus anyone assigned to the whole chore (zoneId IS NULL applies across
// all of its zones) — same "whole chore vs. one zone" split the schema documents for
// choreAssignments.zoneId. Never queues for requestingUserId (when there is one) — a
// user is never notified about a change they made themselves.
function notifyAssignees(
  choreId: number,
  zoneId: number | null,
  choreName: string,
  requestingUserId: number | null,
  queueFn: QueueNotificationFn,
): void {
  const assignments = db
    .select({ userId: choreAssignments.userId })
    .from(choreAssignments)
    .where(
      zoneId === null
        ? eq(choreAssignments.choreId, choreId)
        : and(
            eq(choreAssignments.choreId, choreId),
            or(isNull(choreAssignments.zoneId), eq(choreAssignments.zoneId, zoneId)),
          ),
    )
    .all();

  const userIds = new Set(assignments.map((row) => row.userId));
  // null means a system-triggered change (see systemReopenChore/systemReopenChoreZone)
  // — there's no acting human to exclude, so every assignee gets notified.
  if (requestingUserId !== null) userIds.delete(requestingUserId);
  for (const userId of userIds) {
    queueFn(userId, choreId, zoneId, choreName);
  }
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

// Internal system query for dailyReminderScheduler.ts — not exposed via any route, so
// it deliberately skips the requireMembership/requester-vs-subject checks every
// user-facing chore query goes through; there's no "requester" here, just "does this
// user have anything outstanding right now."
export function userHasIncompleteAssignedChores(userId: number): boolean {
  const assignments = db
    .select({ choreId: choreAssignments.choreId, zoneId: choreAssignments.zoneId })
    .from(choreAssignments)
    .where(eq(choreAssignments.userId, userId))
    .all();

  const choreIds = [...new Set(assignments.map((assignment) => assignment.choreId))];
  if (choreIds.length === 0) return false;

  const choreRows = db.select(CHORE_ROW_COLUMNS).from(chores).where(inArray(chores.id, choreIds)).all();
  const summaryByChoreId = new Map(attachDetails(choreRows).map((summary) => [summary.id, summary]));

  for (const assignment of assignments) {
    const summary = summaryByChoreId.get(assignment.choreId);
    if (!summary) continue;
    if (assignment.zoneId === null) {
      if (summary.status !== 'complete') return true;
    } else {
      const zone = summary.zones.find((candidate) => candidate.zoneId === assignment.zoneId);
      if (zone && zone.status !== 'complete') return true;
    }
  }
  return false;
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
      .values({ householdId, name, todoSince: now, createdAt: now })
      .returning()
      .get();

    if (uniqueZoneIds.length > 0) {
      tx.insert(choreZones)
        .values(uniqueZoneIds.map((zoneId) => ({ choreId: inserted.id, zoneId, todoSince: now })))
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

  if (
    assigneeUserId !== requestingUserId &&
    getMembership(householdId, assigneeUserId)?.status !== 'active'
  ) {
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

  if (assigneeUserId !== requestingUserId) {
    queueAssignmentNotification(assigneeUserId, choreId, zoneId, chore.name);
  }

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
  status: ChoreStatus,
): ChoreSummary {
  const role = requireMembership(householdId, requestingUserId);
  if (status === 'overdue' && role !== 'head') throw new NotHeadOfHouseholdError();

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const anyZoneLink = db
    .select({ id: choreZones.id })
    .from(choreZones)
    .where(eq(choreZones.choreId, choreId))
    .get();
  if (anyZoneLink) throw new ChoreStatusManagedByZonesError();

  const previousStatus = chore.status;
  const becomingToDo = status === 'to-do' && previousStatus !== 'to-do';
  const now = Date.now();
  db.update(chores)
    .set(becomingToDo ? { status, todoSince: now } : { status })
    .where(eq(chores.id, choreId))
    .run();
  if (becomingToDo) refreshOverdueAtForTarget(choreId, null, now);

  if (status === 'overdue') {
    notifyAssignees(choreId, null, chore.name, requestingUserId, queueOverdueNotification);
  } else if (status === 'to-do' && previousStatus === 'complete') {
    notifyAssignees(choreId, null, chore.name, requestingUserId, queueReopenedNotification);
  }

  return attachDetailsToOne({ ...chore, status });
}

export function setChoreZoneStatus(
  householdId: number,
  choreId: number,
  zoneId: number,
  requestingUserId: number,
  status: ChoreStatus,
): ChoreSummary {
  const role = requireMembership(householdId, requestingUserId);
  if (status === 'overdue' && role !== 'head') throw new NotHeadOfHouseholdError();

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const link = db
    .select({ id: choreZones.id, status: choreZones.status })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link) throw new ChoreZoneMismatchError();

  const becomingToDo = status === 'to-do' && link.status !== 'to-do';
  const now = Date.now();
  db.update(choreZones)
    .set(becomingToDo ? { status, todoSince: now } : { status })
    .where(eq(choreZones.id, link.id))
    .run();
  if (becomingToDo) refreshOverdueAtForTarget(choreId, zoneId, now);

  if (status === 'overdue') {
    notifyAssignees(choreId, zoneId, chore.name, requestingUserId, queueOverdueNotification);
  } else if (status === 'to-do' && link.status === 'complete') {
    notifyAssignees(choreId, zoneId, chore.name, requestingUserId, queueReopenedNotification);
  }

  return attachDetailsToOne(chore);
}

// Internal system mutation for choreScheduler.ts — flips a zoneless chore's status
// from 'complete' back to 'to-do' when its schedule fires, skipping the
// requireMembership/role checks every user-facing status change goes through, since
// there's no requesting user, only "this schedule says it's time." No-ops (returns
// false) if the chore isn't currently 'complete' — an 'overdue' chore is deliberately
// left alone so a missed cycle stays visible rather than being silently cleared, and
// an already-'to-do' chore has nothing to do.
export function systemReopenChore(choreId: number): boolean {
  const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore || chore.status !== 'complete') return false;

  const now = Date.now();
  db.update(chores).set({ status: 'to-do', todoSince: now }).where(eq(chores.id, choreId)).run();
  refreshOverdueAtForTarget(choreId, null, now);
  notifyAssignees(choreId, null, chore.name, null, queueReopenedNotification);
  return true;
}

// Same as systemReopenChore, but for one zone-link of a chore.
export function systemReopenChoreZone(choreId: number, zoneId: number): boolean {
  const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore) return false;

  const link = db
    .select({ id: choreZones.id, status: choreZones.status })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link || link.status !== 'complete') return false;

  const now = Date.now();
  db.update(choreZones).set({ status: 'to-do', todoSince: now }).where(eq(choreZones.id, link.id)).run();
  refreshOverdueAtForTarget(choreId, zoneId, now);
  notifyAssignees(choreId, zoneId, chore.name, null, queueReopenedNotification);
  return true;
}

// Internal system mutation for choreScheduler.ts's overdue poll — flips a zoneless
// chore's status from 'to-do' to 'overdue' when its overdue timer has elapsed,
// skipping the requireMembership/head-only role check every user-facing overdue
// transition goes through, since there's no requesting user. No-ops (returns
// false) if the chore isn't currently 'to-do' — it may have been completed in
// time, or already overdue via another path. Reuses the exact same
// queueOverdueNotification path the manual "Mark overdue" action already uses, so
// assignees are notified the same way either way.
export function systemMarkOverdue(choreId: number): boolean {
  const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore || chore.status !== 'to-do') return false;

  db.update(chores).set({ status: 'overdue' }).where(eq(chores.id, choreId)).run();
  notifyAssignees(choreId, null, chore.name, null, queueOverdueNotification);
  return true;
}

// Same as systemMarkOverdue, but for one zone-link of a chore.
export function systemMarkOverdueZone(choreId: number, zoneId: number): boolean {
  const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore) return false;

  const link = db
    .select({ id: choreZones.id, status: choreZones.status })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link || link.status !== 'to-do') return false;

  db.update(choreZones).set({ status: 'overdue' }).where(eq(choreZones.id, link.id)).run();
  notifyAssignees(choreId, zoneId, chore.name, null, queueOverdueNotification);
  return true;
}
