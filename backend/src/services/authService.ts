import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { households, householdMembers, sessions, users, zones } from '../db/schema.js';
import type { HouseholdRole } from '../db/schema.js';
import type { Transaction } from '../db/client.js';
import {
  generateJoinCode,
  generateSessionToken,
  hashPassword,
  normalizeJoinCode,
  verifyPassword,
} from './authCrypto.js';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidJoinCodeError,
  UsernameAlreadyTakenError,
} from '../errors.js';
import type { RegisterInput, LoginInput } from '../validation/authSchemas.js';

export const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;

const JOIN_CODE_GENERATION_ATTEMPTS = 10;

export interface PublicUser {
  id: number;
  email: string;
  username: string;
}

export interface PublicHousehold {
  id: number;
  name: string;
  joinCode: string;
  role: HouseholdRole;
}

export interface AuthResult {
  user: PublicUser;
  households: PublicHousehold[];
  token: string;
}

function insertHouseholdWithUniqueJoinCode(
  tx: Transaction,
  name: string,
  createdByUserId: number,
  now: number,
) {
  for (let attempt = 0; attempt < JOIN_CODE_GENERATION_ATTEMPTS; attempt++) {
    const joinCode = generateJoinCode();
    const existing = tx
      .select({ id: households.id })
      .from(households)
      .where(eq(households.joinCode, joinCode))
      .get();
    if (existing) continue;
    return tx
      .insert(households)
      .values({ name, joinCode, createdByUserId, createdAt: now })
      .returning()
      .get();
  }
  throw new Error('Failed to generate a unique household join code');
}

export function isEmailAvailable(email: string): boolean {
  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  return !existing;
}

export function isUsernameAvailable(username: string): boolean {
  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get();
  return !existing;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  const token = generateSessionToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  const { user, household, role } = db.transaction((tx) => {
    const existingUser = tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .get();
    if (existingUser) throw new EmailAlreadyRegisteredError();

    const existingUsername = tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, input.username))
      .get();
    if (existingUsername) throw new UsernameAlreadyTakenError();

    const user = tx
      .insert(users)
      .values({ email: input.email, username: input.username, passwordHash, createdAt: now })
      .returning()
      .get();

    // The person who creates a household is its first Head of Household.
    let household: typeof households.$inferSelect;
    let role: HouseholdRole;
    if (input.household.mode === 'create') {
      household = insertHouseholdWithUniqueJoinCode(tx, input.household.name, user.id, now);
      role = 'head';
      // Every household starts with one unremovable root zone representing
      // the household itself, which every other zone nests under.
      tx.insert(zones)
        .values({
          householdId: household.id,
          parentZoneId: null,
          name: household.name,
          createdAt: now,
        })
        .run();
    } else {
      const joinCode = normalizeJoinCode(input.household.joinCode);
      const found = tx.select().from(households).where(eq(households.joinCode, joinCode)).get();
      if (!found) throw new InvalidJoinCodeError();
      household = found;
      role = 'member';
    }

    tx.insert(householdMembers)
      .values({ userId: user.id, householdId: household.id, role, createdAt: now })
      .run();

    tx.insert(sessions).values({ token, userId: user.id, createdAt: now, expiresAt }).run();

    return { user, household, role };
  });

  return {
    user: { id: user.id, email: user.email, username: user.username },
    households: [{ id: household.id, name: household.name, joinCode: household.joinCode, role }],
    token,
  };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = db.select().from(users).where(eq(users.email, input.email)).get();
  if (!user) throw new InvalidCredentialsError();

  const passwordValid = await verifyPassword(user.passwordHash, input.password);
  if (!passwordValid) throw new InvalidCredentialsError();

  const token = generateSessionToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  const memberHouseholds = db
    .select({
      id: households.id,
      name: households.name,
      joinCode: households.joinCode,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .innerJoin(households, eq(householdMembers.householdId, households.id))
    .where(eq(householdMembers.userId, user.id))
    .all();

  db.insert(sessions).values({ token, userId: user.id, createdAt: now, expiresAt }).run();

  return {
    user: { id: user.id, email: user.email, username: user.username },
    households: memberHouseholds,
    token,
  };
}

export function logout(token: string): void {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}

export function getSessionUser(
  token: string,
): { user: PublicUser; households: PublicHousehold[] } | null {
  const session = db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (!session || session.expiresAt < Date.now()) return null;

  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;

  const memberHouseholds = db
    .select({
      id: households.id,
      name: households.name,
      joinCode: households.joinCode,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .innerJoin(households, eq(householdMembers.householdId, households.id))
    .where(eq(householdMembers.userId, user.id))
    .all();

  return {
    user: { id: user.id, email: user.email, username: user.username },
    households: memberHouseholds,
  };
}
