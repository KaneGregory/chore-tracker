import { describe, expect, it } from 'vitest';
import {
  generateJoinCode,
  generateSessionToken,
  hashPassword,
  normalizeJoinCode,
  verifyPassword,
} from './authCrypto.js';

describe('hashPassword / verifyPassword', () => {
  it('verifies a password against its own hash', async () => {
    const hash = await hashPassword('correct-horse-battery');
    await expect(verifyPassword(hash, 'correct-horse-battery')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('produces a different hash each time (salted)', async () => {
    const [hashA, hashB] = await Promise.all([
      hashPassword('correct-horse-battery'),
      hashPassword('correct-horse-battery'),
    ]);
    expect(hashA).not.toBe(hashB);
  });
});

describe('generateSessionToken', () => {
  it('generates a sufficiently long, URL-safe, unique token each call', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('generateJoinCode', () => {
  it('generates an 8-character code using only the Crockford base32 alphabet', () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('excludes visually ambiguous characters I, L, O, U', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateJoinCode()).not.toMatch(/[ILOU]/);
    }
  });
});

describe('normalizeJoinCode', () => {
  it('strips hyphens and uppercases', () => {
    expect(normalizeJoinCode('f8xr-ck4r')).toBe('F8XRCK4R');
  });

  it('is idempotent on an already-normalized code', () => {
    expect(normalizeJoinCode('F8XRCK4R')).toBe('F8XRCK4R');
  });
});
