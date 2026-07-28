import { randomBytes, randomInt } from 'node:crypto';
import * as argon2 from 'argon2';

// Crockford base32: excludes I, L, O, U to avoid visual ambiguity with 1, 0.
const JOIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const JOIN_CODE_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeJoinCode(joinCode: string): string {
  return joinCode.replace(/-/g, '').toUpperCase();
}
