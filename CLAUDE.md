## Purpose
To help the members of a household to manage chores.

## Architectural decisions
* Two components:
* 1) A backend that records chore info for households.
* 2) A web interface for individual users.
* UI will be built using React.
* UI must be installable as App on multiple individuals' phones (Android).
* Repo layout: single repo, top-level `/backend` and `/frontend`, each with its own
  `package.json` (no npm workspaces). A root `package.json` only exists to run both
  dev servers together (`npm run dev`).
* Backend: Node.js + TypeScript + Express. Database: SQLite via Drizzle ORM
  (`drizzle-orm` + `better-sqlite3` driver) — schema in `backend/src/db/schema.ts`,
  migrations generated with `npm run db:generate` and committed to `backend/drizzle/`.
* Auth: email + password, hashed with `argon2` (library defaults). Sessions are
  server-side rows (`sessions` table) referenced by an opaque random token stored in
  an httpOnly cookie — not JWT — so a session can be revoked by deleting its row.
* A user's household membership is a many-to-many join table (`household_members`),
  not a single FK on `users`, so a user can belong to multiple households without a
  future migration.
* Frontend: Vite + React + TypeScript, `react-router` (not `react-router-dom` — v8
  merged the two packages; import from `react-router`) for routing, `vite-plugin-pwa`
  for installability (manifest + service worker).
* Fail fast on missing required config rather than degrading silently — e.g. the
  backend refuses to start without `CORS_ORIGIN` set, because the `cors` package
  treats a falsy `origin` as `*`, which combined with `credentials: true` is a
  fail-open misconfiguration.

## All code should be

1) Correct
2) Clear
3) Maintainable

## Dos and Do Nots

Do:
* Break views down into logical components.
* Use reducers and context to share app state.
* Update this file with new dos and do nots based on architectural decisions.
* Ask who will verify each change (you, the user, or someone else), rather than wasting tokens on verification the user could do themselves.
* Add frequently-used shell commands (typechecking, verification, etc.) as `package.json` scripts instead of retyping them each time.
* Before considering a change done, run `npm run typecheck`, `npm run lint`, and
  `npm test` (backend only, for now) in the relevant workspace(s).

Do not:
* Add multiple components to a single file.
* Comment code except when describing why something had to be done in a non-obvious way.

## Available scripts

Run from within `backend/` or `frontend/` unless noted:
* `npm run dev` — start that workspace's dev server. From the repo root, `npm run dev`
  starts both via `concurrently`.
* `npm run typecheck` — TypeScript, no emit.
* `npm run lint` / `npm run format` — ESLint / Prettier.
* `npm test` (backend only) — Vitest.
* `npm run db:generate` / `npm run db:migrate` (backend only) — Drizzle migrations.

## Known gaps (v1 registration/household feature)

* No password reset or email verification — anyone with a household's join code can
  join with any email address, even one they don't own. Acceptable for a
  household-trust-model app for now, but worth knowing about before someone finds it
  and assumes it's a bug.
* No rate limiting on `/api/auth/register` or `/api/auth/login`.
* `EmailAlreadyRegistered` (409) reveals whether an email is already registered;
  `InvalidCredentials` and `InvalidJoinCode` are deliberately generic to avoid the
  same leak on login/join.

## Dependency vulnerabilities

Both `package.json`s have an `overrides` block forcing a patched transitive
dependency version where the direct dependency itself hasn't published a fix yet:
* `frontend`: `brace-expansion` → `^5.0.8` (patches a DoS advisory pulled in via
  `vite-plugin-pwa` → `workbox-build`'s build-time templating deps).
* `backend`: `esbuild` → `^0.25.0` (patches a dev-server request-forwarding advisory
  pulled in via `drizzle-kit`'s deprecated `@esbuild-kit/*` loader).

Both are transitive, dev/build-time-only tools we don't invoke in a way that exposes
the vulnerable behavior — but pinning past them is free and keeps `npm audit` clean.
After changing dependencies, re-run `npm audit` in the affected workspace and verify
the override still resolves the real reported version (`npm ls <package>`), not just
that `npm install` didn't error — overrides can silently fail to apply to a deeply
nested copy if the override key doesn't match the exact parent chain.

## Post-change review workflow

After any code change is complete (before considering the task done), review the
change in three separate passes. Do not combine these into a single pass — each is
dedicated to one concern so it gets full attention:

1. **Correctness pass.** Re-read the diff and ask: does this actually do what it's
   supposed to do? Check logic, edge cases, error handling, and that tests (if any)
   genuinely exercise the change rather than just asserting it didn't crash.
2. **Architecture pass.** Re-read the diff again, this time for structure: does it fit
   the existing patterns in the codebase, is it in the right place, is there
   unnecessary duplication or an abstraction that should be reused instead, is
   anything over- or under-engineered for what was asked.
3. **Security pass.** Re-read the diff a third time specifically for security issues:
   injection (SQL, command, prompt), unsanitized input crossing a trust boundary,
   secrets or credentials handled unsafely, path traversal, and similar OWASP-style
   concerns.

Each pass should be a distinct read-through of the change with that pass's question in
mind — not a single review that tries to think about all three at once.