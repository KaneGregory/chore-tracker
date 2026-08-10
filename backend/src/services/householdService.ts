import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households, householdMembers, users } from '../db/schema.js';
import type { HouseholdMemberStatus } from '../db/schema.js';
import {
  ApplicationNotPendingError,
  CannotDemoteHouseholdCreatorError,
  CannotDemoteSelfError,
  MemberNotFoundError,
  TargetMemberHasAccountError,
  UsernameAlreadyTakenError,
} from '../errors.js';
import { getMembership, requireHeadMembership, requireMembership } from './membershipAuth.js';

export interface HouseholdMember {
  id: number;
  username: string;
  role: 'member' | 'head';
  status: HouseholdMemberStatus;
  isCreator: boolean;
  // Whether this member can log in as themselves — false for a member a Head of
  // Household created directly (see createMember) rather than approving a join.
  hasAccount: boolean;
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
    .select({
      id: users.id,
      username: users.username,
      role: householdMembers.role,
      status: householdMembers.status,
      email: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.createdAt))
    .all();

  return rows.map(({ email, ...row }) => ({
    ...row,
    isCreator: row.id === createdByUserId,
    hasAccount: email !== null,
  }));
}

function findMembershipRow(householdId: number, userId: number) {
  return db
    .select({ id: householdMembers.id, status: householdMembers.status })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
    .get();
}

/**
 * A head sees every applicant, pending or active, since approving/declining them is
 * the whole point of a head viewing this list. Anyone else only sees active members —
 * a pending applicant isn't a real member of the household yet.
 */
export function getMembersForRequester(
  householdId: number,
  requestingUserId: number,
): HouseholdMember[] {
  const role = requireMembership(householdId, requestingUserId);
  const members = listMembers(householdId);
  return role === 'head' ? members : members.filter((member) => member.status === 'active');
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

    // Created directly by a head, not a self-service join, so no approval is needed.
    tx.insert(householdMembers)
      .values({ userId: newUser.id, householdId, role: 'member', status: 'active', createdAt: now })
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
  if (!targetMembership || targetMembership.status !== 'active') throw new MemberNotFoundError();

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
  if (!targetMembership || targetMembership.status !== 'active') throw new MemberNotFoundError();

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

export function approveMember(
  householdId: number,
  requestingUserId: number,
  targetUserId: number,
): HouseholdMember[] {
  requireHeadMembership(householdId, requestingUserId);

  const targetMembership = findMembershipRow(householdId, targetUserId);
  if (!targetMembership) throw new MemberNotFoundError();
  if (targetMembership.status !== 'pending') throw new ApplicationNotPendingError();

  db.update(householdMembers)
    .set({ status: 'active' })
    .where(eq(householdMembers.id, targetMembership.id))
    .run();

  return listMembers(householdId);
}

export function declineMember(
  householdId: number,
  requestingUserId: number,
  targetUserId: number,
): HouseholdMember[] {
  requireHeadMembership(householdId, requestingUserId);

  const targetMembership = findMembershipRow(householdId, targetUserId);
  if (!targetMembership) throw new MemberNotFoundError();
  if (targetMembership.status !== 'pending') throw new ApplicationNotPendingError();

  // Removes only this membership, not the person's account — they keep their login
  // and simply end up with one less household, same as anyone who was never in one.
  db.delete(householdMembers).where(eq(householdMembers.id, targetMembership.id)).run();

  return listMembers(householdId);
}

// "Assigning" a pending applicant to an existing account-less member (see
// createMember) means they're the same real person: a head added a placeholder for
// someone before that person had their own login, and now that person has joined for
// real. This transplants the applicant's email/password onto the placeholder's user
// row — preserving the placeholder's id, username, role, and chore-assignment
// history — then deletes the applicant's now-redundant account.
export function assignPendingMember(
  householdId: number,
  requestingUserId: number,
  pendingUserId: number,
  targetMemberId: number,
): HouseholdMember[] {
  requireHeadMembership(householdId, requestingUserId);

  const pendingMembership = findMembershipRow(householdId, pendingUserId);
  if (!pendingMembership) throw new MemberNotFoundError();
  if (pendingMembership.status !== 'pending') throw new ApplicationNotPendingError();

  const targetMembership = getMembership(householdId, targetMemberId);
  if (!targetMembership || targetMembership.status !== 'active') throw new MemberNotFoundError();

  const targetUser = db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, targetMemberId))
    .get();
  if (!targetUser) throw new MemberNotFoundError();
  if (targetUser.email !== null) throw new TargetMemberHasAccountError();

  // Guaranteed non-null: a 'pending' row only ever comes from a real registration
  // (see authService.register), never from createMember's account-less members.
  const pendingUser = db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, pendingUserId))
    .get()!;

  db.transaction((tx) => {
    // Deleted first: the target's row can't take over this email while the pending
    // user's row (which currently holds it) still exists, since email is unique.
    // Cascades away the now-orphaned pending household_members row too.
    tx.delete(users).where(eq(users.id, pendingUserId)).run();

    tx.update(users)
      .set({ email: pendingUser.email, passwordHash: pendingUser.passwordHash })
      .where(eq(users.id, targetMemberId))
      .run();
  });

  return listMembers(householdId);
}
