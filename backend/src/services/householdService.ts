import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { householdMembers, users } from '../db/schema.js';
import { MemberNotFoundError } from '../errors.js';
import { getMembership, requireHeadMembership, requireMembership } from './membershipAuth.js';

export interface HouseholdMember {
  id: number;
  username: string;
  role: 'member' | 'head';
}

function listMembers(householdId: number): HouseholdMember[] {
  return db
    .select({ id: users.id, username: users.username, role: householdMembers.role })
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
  requireMembership(householdId, requestingUserId);
  return listMembers(householdId);
}

export function promoteMember(
  householdId: number,
  requestingUserId: number,
  targetUserId: number,
): HouseholdMember[] {
  requireHeadMembership(householdId, requestingUserId);

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
