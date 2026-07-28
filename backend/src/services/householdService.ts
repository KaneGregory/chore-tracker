import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { householdMembers, users } from '../db/schema.js';
import { HouseholdNotFoundError, MemberNotFoundError, NotHeadOfHouseholdError } from '../errors.js';

export interface HouseholdMember {
  id: number;
  email: string;
  role: 'member' | 'head';
}

function getMembership(householdId: number, userId: number) {
  return db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .get();
}

function listMembers(householdId: number): HouseholdMember[] {
  return db
    .select({ id: users.id, email: users.email, role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.createdAt))
    .all();
}

export function getMembersForRequester(
  householdId: number,
  requestingUserId: number,
): HouseholdMember[] {
  const requesterMembership = getMembership(householdId, requestingUserId);
  if (!requesterMembership) throw new HouseholdNotFoundError();

  return listMembers(householdId);
}

export function promoteMember(
  householdId: number,
  requestingUserId: number,
  targetUserId: number,
): HouseholdMember[] {
  const requesterMembership = getMembership(householdId, requestingUserId);
  if (!requesterMembership) throw new HouseholdNotFoundError();
  if (requesterMembership.role !== 'head') throw new NotHeadOfHouseholdError();

  const targetMembership = getMembership(householdId, targetUserId);
  if (!targetMembership) throw new MemberNotFoundError();

  db.update(householdMembers)
    .set({ role: 'head' })
    .where(
      and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId)),
    )
    .run();

  return listMembers(householdId);
}
