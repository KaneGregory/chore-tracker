import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'session';

export function sessionCookieOptions(maxAgeMs: number): CookieOptions {
  // In dev, frontend/backend differ only by port (localhost:5173 vs :3001), which
  // SameSite policy treats as the same site — 'lax' works fine. In production they're
  // on different subdomains of a Public-Suffix-List-registered domain (e.g. Render's
  // onrender.com, which deliberately registers itself so *.onrender.com services get
  // separate cookie/storage boundaries), making them genuinely cross-site — only
  // 'none' (paired with `secure`, required by browsers for SameSite=None) lets the
  // cookie ride along on the frontend's cross-origin fetch() calls at all.
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
    maxAge: maxAgeMs,
  };
}
