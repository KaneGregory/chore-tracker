import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chores, choreZones, choreAssignments } from '../db/schema.js';
import { notifyUser } from './pushService.js';

// "Small amount of time" per the spec this implements — long enough to coalesce a
// burst of related edits (e.g. a head reviewing several chores in a row) into one
// notification instead of a flurry of them, short enough to still feel timely.
// Nothing else depends on this value; retune freely.
const BATCH_DELAY_MS = 2 * 60 * 1000;

type PendingItemType = 'overdue' | 'reopened' | 'assigned';

interface PendingItem {
  type: PendingItemType;
  choreId: number;
  zoneId: number | null;
  choreName: string;
}

interface PendingBatch {
  items: PendingItem[];
  timer: ReturnType<typeof setTimeout>;
}

// Keyed by recipient userId — one debounce timer per person, not per chore/event, so
// unrelated changes affecting the same person still coalesce into one notification.
const pendingBatches = new Map<number, PendingBatch>();

function itemKey(item: PendingItem): string {
  return `${item.type}:${item.choreId}:${item.zoneId ?? 'none'}`;
}

function queue(userId: number, item: PendingItem): void {
  const existing = pendingBatches.get(userId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.items.push(item);
    existing.timer = setTimeout(() => flush(userId), BATCH_DELAY_MS);
    return;
  }
  pendingBatches.set(userId, {
    items: [item],
    timer: setTimeout(() => flush(userId), BATCH_DELAY_MS),
  });
}

// Call sites (choreService.ts) are responsible for never queuing a notification for
// whoever performed the action — a user should never be told about their own change.

export function queueOverdueNotification(
  userId: number,
  choreId: number,
  zoneId: number | null,
  choreName: string,
): void {
  queue(userId, { type: 'overdue', choreId, zoneId, choreName });
}

export function queueReopenedNotification(
  userId: number,
  choreId: number,
  zoneId: number | null,
  choreName: string,
): void {
  queue(userId, { type: 'reopened', choreId, zoneId, choreName });
}

export function queueAssignmentNotification(
  userId: number,
  choreId: number,
  zoneId: number | null,
  choreName: string,
): void {
  queue(userId, { type: 'assigned', choreId, zoneId, choreName });
}

function currentStatus(choreId: number, zoneId: number | null): string | null {
  if (zoneId === null) {
    const row = db.select({ status: chores.status }).from(chores).where(eq(chores.id, choreId)).get();
    return row?.status ?? null;
  }
  const row = db
    .select({ status: choreZones.status })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  return row?.status ?? null;
}

function isAssignmentStillActive(choreId: number, zoneId: number | null, userId: number): boolean {
  const row = db
    .select({ id: choreAssignments.id })
    .from(choreAssignments)
    .where(
      and(
        eq(choreAssignments.choreId, choreId),
        eq(choreAssignments.userId, userId),
        zoneId === null ? isNull(choreAssignments.zoneId) : eq(choreAssignments.zoneId, zoneId),
      ),
    )
    .get();
  return row !== undefined;
}

// Re-checked against current state at flush time, not the state at queue time — e.g.
// a chore queued as 'overdue' that's since been marked complete no longer warrants a
// notification at all.
function isStillRelevant(item: PendingItem, userId: number): boolean {
  switch (item.type) {
    case 'overdue':
      return currentStatus(item.choreId, item.zoneId) === 'overdue';
    case 'reopened':
      return currentStatus(item.choreId, item.zoneId) === 'to-do';
    case 'assigned':
      return isAssignmentStillActive(item.choreId, item.zoneId, userId);
  }
}

const SINGLE_ITEM_TITLE: Record<PendingItemType, string> = {
  overdue: 'Chore overdue',
  reopened: 'Chore reopened',
  assigned: 'New chore assigned',
};

const ITEM_DESCRIPTION: Record<PendingItemType, (choreName: string) => string> = {
  overdue: (name) => `${name} is overdue`,
  reopened: (name) => `${name} needs doing again`,
  assigned: (name) => `You were assigned ${name}`,
};

interface Digest {
  title: string;
  body: string;
  url: string;
}

function buildPayload(items: PendingItem[]): Digest {
  if (items.length === 1) {
    const item = items[0]!;
    return { title: SINGLE_ITEM_TITLE[item.type], body: item.choreName, url: '/' };
  }
  return {
    title: `${items.length} chore updates`,
    body: items.map((item) => ITEM_DESCRIPTION[item.type](item.choreName)).join('; '),
    url: '/',
  };
}

function flush(userId: number): void {
  const batch = pendingBatches.get(userId);
  pendingBatches.delete(userId);
  if (!batch) return;

  // Deduped by (type, chore, zone) — the same thing flapping repeatedly within the
  // window (e.g. overdue → complete → overdue again) should only ever describe itself
  // once; isStillRelevant already re-derives the CURRENT truth, so which occurrence
  // survives the dedupe doesn't matter.
  const seen = new Set<string>();
  const deduped: PendingItem[] = [];
  for (const item of batch.items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const survivors = deduped.filter((item) => isStillRelevant(item, userId));
  if (survivors.length === 0) return;

  notifyUser(userId, buildPayload(survivors));
}
