import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { zones } from '../db/schema.js';
import { InvalidZoneMoveError, RootZoneImmutableError, ZoneNotFoundError } from '../errors.js';
import { requireHeadMembership, requireMembership } from './membershipAuth.js';

export interface ZoneNode {
  id: number;
  name: string;
  isRoot: boolean;
  children: ZoneNode[];
}

interface ZoneRow {
  id: number;
  householdId: number;
  parentZoneId: number | null;
  name: string;
}

function getZone(householdId: number, zoneId: number): ZoneRow | undefined {
  return db
    .select({
      id: zones.id,
      householdId: zones.householdId,
      parentZoneId: zones.parentZoneId,
      name: zones.name,
    })
    .from(zones)
    .where(and(eq(zones.id, zoneId), eq(zones.householdId, householdId)))
    .get();
}

function buildTree(rows: ZoneRow[]): ZoneNode {
  const byParent = new Map<number | null, ZoneRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentZoneId) ?? [];
    siblings.push(row);
    byParent.set(row.parentZoneId, siblings);
  }

  function toNode(row: ZoneRow): ZoneNode {
    return {
      id: row.id,
      name: row.name,
      isRoot: row.parentZoneId === null,
      children: (byParent.get(row.id) ?? []).map(toNode),
    };
  }

  const root = rows.find((row) => row.parentZoneId === null);
  if (!root) throw new Error(`Household ${rows[0]?.householdId} has no root zone`);
  return toNode(root);
}

function listZoneRows(householdId: number): ZoneRow[] {
  return db
    .select({
      id: zones.id,
      householdId: zones.householdId,
      parentZoneId: zones.parentZoneId,
      name: zones.name,
    })
    .from(zones)
    .where(eq(zones.householdId, householdId))
    .all();
}

/** Every zone id from `zoneId` down through its descendants, including itself. */
function subtreeIds(rows: ZoneRow[], zoneId: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentZoneId === null) continue;
    const siblings = childrenOf.get(row.parentZoneId) ?? [];
    siblings.push(row.id);
    childrenOf.set(row.parentZoneId, siblings);
  }

  const ids = new Set<number>();
  const stack = [zoneId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (ids.has(current)) continue;
    ids.add(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return ids;
}

export function getZoneTreeForRequester(householdId: number, requestingUserId: number): ZoneNode {
  requireMembership(householdId, requestingUserId);
  return buildTree(listZoneRows(householdId));
}

export function createZone(
  householdId: number,
  requestingUserId: number,
  name: string,
  parentZoneId: number,
): ZoneNode {
  requireHeadMembership(householdId, requestingUserId);

  const parent = getZone(householdId, parentZoneId);
  if (!parent) throw new ZoneNotFoundError();

  const now = Date.now();
  db.insert(zones).values({ householdId, parentZoneId, name, createdAt: now }).run();

  return buildTree(listZoneRows(householdId));
}

export function removeZone(
  householdId: number,
  requestingUserId: number,
  zoneId: number,
): ZoneNode {
  requireHeadMembership(householdId, requestingUserId);

  const zone = getZone(householdId, zoneId);
  if (!zone) throw new ZoneNotFoundError();
  if (zone.parentZoneId === null) throw new RootZoneImmutableError();

  // Relies on the zones table's self-referencing ON DELETE CASCADE to remove
  // the whole subtree, not just this row.
  db.delete(zones)
    .where(and(eq(zones.id, zoneId), eq(zones.householdId, householdId)))
    .run();

  return buildTree(listZoneRows(householdId));
}

export function moveZone(
  householdId: number,
  requestingUserId: number,
  zoneId: number,
  newParentZoneId: number,
): ZoneNode {
  requireHeadMembership(householdId, requestingUserId);

  const zone = getZone(householdId, zoneId);
  if (!zone) throw new ZoneNotFoundError();
  if (zone.parentZoneId === null) throw new RootZoneImmutableError();

  const newParent = getZone(householdId, newParentZoneId);
  if (!newParent) throw new ZoneNotFoundError();

  const rows = listZoneRows(householdId);
  if (subtreeIds(rows, zoneId).has(newParentZoneId)) {
    throw new InvalidZoneMoveError();
  }

  db.update(zones)
    .set({ parentZoneId: newParentZoneId })
    .where(and(eq(zones.id, zoneId), eq(zones.householdId, householdId)))
    .run();

  return buildTree(listZoneRows(householdId));
}
