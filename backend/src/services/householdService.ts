import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households, householdMembers, users } from '../db/schema.js';
import {
  CannotDemoteHouseholdCreatorError,
  CannotDemoteSelfError,
  MemberNotFoundError,
  UsernameAlreadyTakenError,
} from '../errors.js';
import { getMembership, requireHeadMembership, requireMembership } from './membershipAuth.js';

export interface HouseholdMember {
  id: number;
  username: string;
  role: 'member' | 'head';
  isCreator: boolean;
}

function getCreatedByUserId(householdId: number): number | undefined {
  return db
    .select({ createdByUserId: households.createdByUserId })
    .from(households)
    .where(eq(households.id, householdId))
    .get()?.createdByUserId;
}

function listMembers(householdId: number): HouseholdMember[] {
  const createdByUserId = getCreatedByUserId(householdId);

  const rows = db
    .select({ id: users.id, username: users.username, role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.createdAt))
    .all();

  return rows.map((row) => ({ ...row, isCreator: row.id === createdByUserId }));
}

export function getMembersForRequester(
  householdId: number,
  requestingUserId: number,
): HouseholdMember[] {
  requireMembership(householdId, requestingUserId);
  return listMembers(householdId);
}

export function createMember(
  householdId: number,
  requestingUserId: number,
  username: string,
): HouseholdMember[] {
  requireHeadMembership(householdId, requestingUserId);

  const now = Date.now();
  db.transaction((tx) => {
    const existingUsername = tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get();
    if (existingUsername) throw new UsernameAlreadyTakenError();

    // No email/passwordHash — this member has no account of their own and can never
    // log in (see authService.login, which can only find a user by a non-null email).
    const newUser = tx
      .insert(users)
      .values({ username, email: null, passwordHash: null, createdAt: now })
      .returning()
      .get();

    tx.insert(householdMembers)
      .values({ userId: newUser.id, householdId, role: 'member', createdAt: now })
      .run();
  });

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

export function demoteMember(
  householdId: number,
  requestingUserId: number,
  targetUserId: number,
): HouseholdMember[] {
  requireHeadMembership(householdId, requestingUserId);

  if (targetUserId === requestingUserId) throw new CannotDemoteSelfError();

  const targetMembership = getMembership(householdId, targetUserId);
  if (!targetMembership) throw new MemberNotFoundError();

  if (getCreatedByUserId(householdId) === targetUserId) {
    throw new CannotDemoteHouseholdCreatorError();
  }

  db.update(householdMembers)
    .set({ role: 'member' })
    .where(
      and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId)),
    )
    .run();

  return listMembers(householdId);
}
