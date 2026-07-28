import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { householdMembers } from '../db/schema.js';
import type { HouseholdRole } from '../db/schema.js';
import { HouseholdNotFoundError, NotHeadOfHouseholdError } from '../errors.js';

export function getMembership(householdId: number, userId: number) {
  return db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .get();
}

/** Throws HouseholdNotFoundError if the user isn't a member of this household. */
export function requireMembership(householdId: number, userId: number): HouseholdRole {
  const membership = getMembership(householdId, userId);
  if (!membership) throw new HouseholdNotFoundError();
  return membership.role;
}

/** Throws HouseholdNotFoundError or NotHeadOfHouseholdError as appropriate. */
export function requireHeadMembership(householdId: number, userId: number): void {
  const role = requireMembership(householdId, userId);
  if (role !== 'head') throw new NotHeadOfHouseholdError();
}
