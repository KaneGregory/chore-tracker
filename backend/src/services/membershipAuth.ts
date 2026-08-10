import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { householdMembers } from '../db/schema.js';
import type { HouseholdRole } from '../db/schema.js';
import { HouseholdNotFoundError, NotHeadOfHouseholdError } from '../errors.js';

export function getMembership(householdId: number, userId: number) {
  return db
    .select({ role: householdMembers.role, status: householdMembers.status })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .get();
}

/**
 * Throws HouseholdNotFoundError if the user isn't an active member of this
 * household — including if they're only a 'pending' applicant, who has no real
 * household access yet (see householdService.ts's approve/decline/assign flow).
 */
export function requireMembership(householdId: number, userId: number): HouseholdRole {
  const membership = getMembership(householdId, userId);
  if (!membership || membership.status !== 'active') throw new HouseholdNotFoundError();
  return membership.role;
}

/** Throws HouseholdNotFoundError or NotHeadOfHouseholdError as appropriate. */
export function requireHeadMembership(householdId: number, userId: number): void {
  const role = requireMembership(householdId, userId);
  if (role !== 'head') throw new NotHeadOfHouseholdError();
}
