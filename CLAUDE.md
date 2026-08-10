## Purpose
To help the members of a household to manage chores.

## If you are Claude Code: use `dev:ai`, never `dev`, for your own testing

Run `npm run dev:ai` (root, or per-workspace) whenever *you* need a running instance
of this app — for manual verification, browser automation, curl smoke tests,
whatever. Never run plain `npm run dev` yourself, and never assume a process on port
3001 or 5173 is safe to touch.

* `npm run dev` — the human's. Backend on port 3001 against `chore-tracker.db`,
  frontend on port 5173. May already be running, may have real data in it.
* `npm run dev:ai` — yours. Backend on port 4001 against a separate
  `chore-tracker.ai.db`, frontend on port 4173 (pre-wired via `VITE_API_BASE_URL` to
  talk to the AI backend). Safe to start, use, and tear down freely — it can never
  collide with or read/write the human's data, because it's a completely different
  port and a completely different database file.

**This exists because of a real incident**: an earlier session found unfamiliar
processes on ports 3001/5173, assumed they were leftovers from its own prior testing,
and killed them with `pkill`. They weren't — they belonged to the user, and killing
them interrupted their own work. Don't repeat this.

If you need to stop your own `dev:ai` servers, look them up **by port**, not by
matching the command:

```sh
lsof -tiTCP:4001 -sTCP:LISTEN | xargs -r kill
lsof -tiTCP:4173 -sTCP:LISTEN | xargs -r kill
```

Never use a broad pattern like `pkill -f "tsx watch src/index.ts"` or `pkill -f vite`
to stop your own servers. `dev` and `dev:ai` run the exact same underlying command —
they only differ in environment variables (`PORT`, `DB_FILE`, `CORS_ORIGIN`,
`VITE_API_BASE_URL`), which don't show up in the command line that `pkill -f`
matches against. A pattern match can't tell the two apart and can just as easily kill
the human's dev server as your own. If a port you need is already in use by a process
you don't recognize, stop and ask the user rather than guessing whose it is.

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
  `runMigrations()` (`backend/src/db/client.ts`) toggles `PRAGMA foreign_keys` off
  before calling drizzle's `migrate()` and back on after — needed because any
  migration that recreates a table (dropping a `NOT NULL` constraint, e.g. migration
  `0009`) uses drizzle-kit's generated `PRAGMA foreign_keys=OFF/ON` around the
  drop+rename, but that pragma is a silent no-op once a transaction is open, and
  drizzle's migrator wraps every pending migration in one. Without the toggle in
  `runMigrations()` itself, such a migration passes against a fresh/empty database
  (nothing to violate a constraint yet) and then fails with `FOREIGN KEY constraint
  failed` the moment it runs for real against a database that already has rows in a
  table referencing the one being recreated — this happened for real once, see
  migration `0009`'s history. Verify any future table-recreating migration against a
  scratch copy of the real database using the actual `runMigrations()` function (a
  small `tsx` script with `DB_FILE` pointed at the copy), not the raw `sqlite3` CLI —
  the CLI runs statements in autocommit mode and won't reproduce this class of bug.
* Auth: email + password, hashed with `argon2` (library defaults). Sessions are
  server-side rows (`sessions` table) referenced by an opaque random token stored in
  an httpOnly cookie — not JWT — so a session can be revoked by deleting its row.
* Every user also has a `username` (`users.username`, globally unique, case-sensitive,
  free text — not validated as a slug), chosen at registration before the household
  step and checked for availability the same way email is (`GET
  /api/auth/username-availability`, mirroring `/email-availability`). It's the
  display identity everywhere in the app except the header, which still shows email
  (`AppShell`) — that split is intentional, not an oversight, so don't "fix" it by
  making the header consistent with everywhere else. There's no rename UI yet.
  Migration `0005` was hand-edited from drizzle-kit's generated output to backfill
  pre-existing rows with a `'user-<id>'` placeholder username, since SQLite can't add
  a `NOT NULL` column with no default to a non-empty table — see the comment at the
  top of that migration file before regenerating anything in this area.
* A user's household membership is a many-to-many join table (`household_members`),
  not a single FK on `users`, so a user can belong to multiple households without a
  future migration.
* Household roles: `household_members.role` is `'member'` or `'head'` (Head of
  Household). Whoever creates a household is its first head; whoever joins via code
  starts as a plain member. Any head can promote another member to head, and any head
  can demote another head back to member — except the household's original creator,
  who can never be demoted by anyone (including themselves), and a head can't demote
  themselves either (only "other" heads, per what was asked). The creator is tracked
  explicitly via `households.createdByUserId` (migration `0008`, backfilled for
  pre-existing households from each household's earliest `household_members` row —
  ordered by id, which is always the creation-time head, since a household can't be
  joined via code before it exists) rather than inferred from role state, since role
  alone can't distinguish the creator from any other head once there's more than one.
  Authorization for promote/demote lives in `backend/src/services/householdService.ts`,
  not in routes or middleware: every household-scoped action re-checks the requester's
  own membership row for that specific household id, since role is per-household, not
  a global user property. A user who isn't a member of a household gets the same
  generic 404 (`HouseholdNotFound`) whether the household doesn't exist or they're
  just not in it — same "don't leak existence" pattern as `InvalidJoinCode`.
* Joining a household via code doesn't grant access immediately:
  `household_members.status` is `'pending'` or `'active'`. Creating a household (and
  being created directly by a head — see the account-less-members bullet below) is
  `'active'` right away; joining via code starts `'pending'` until a Head of
  Household resolves it. `membershipAuth.requireMembership` treats a `'pending'` row
  as equivalent to no membership at all (same generic `HouseholdNotFound`) — a
  pending applicant has zero household access, not reduced access, until resolved.
  A head resolves a pending applicant one of three ways, all in
  `householdService.ts`: **approve** (`status` → `'active'`, ordinary new member);
  **decline** (deletes the `household_members` row only — their account and any
  *other* household memberships survive untouched, so "removed from the household"
  doesn't mean "deleted"); or **assign** to an existing account-less member (see
  below) when the applicant is actually that same real person joining for the first
  time — this transplants the applicant's `email`/`passwordHash` onto the
  account-less member's existing `users` row (preserving its id, username, role, and
  chore-assignment history) and deletes the applicant's now-redundant row, rather
  than creating a second membership for the same person. Before deleting that row,
  it also re-points any of the applicant's `sessions` at the account-less member's id
  — without this, the cascade delete on the applicant's `users` row takes their
  session with it, silently logging out whoever's mid-flow on `PendingApprovalPage`
  instead of landing them on the household as the merged identity (this regressed
  once already; the fix is the `UPDATE sessions` in `assignPendingMember` that runs
  before the delete, not after). Regular (non-head) members
  never see pending applicants in the members list at all —
  `getMembersForRequester` filters them out unless the requester is a head.
  Frontend routing for this lives in `ProtectedRoute.tsx`: an authenticated user with
  no *active* household is shown `PendingApprovalPage` (if they have a pending one)
  or `OnboardHouseholdPage` (if they have none at all — e.g. right after being
  declined) instead of the normal app, regardless of which page they were headed to.
  `OnboardHouseholdPage` and `POST /api/households` (`authService.addHouseholdForExistingUser`)
  exist because registration used to be the *only* way to create/join a household —
  don't remove that route thinking it's dead code just because `RegisterPage` doesn't
  call it.
* Not every member has a login: a Head of Household can create a member directly
  (`POST /households/:householdId/members`, `householdService.createMember`) for
  someone who won't ever sign in themselves (e.g. a young child, a relative who just
  wants chores tracked for them). `users.email` and `users.passwordHash` are nullable
  for exactly this case (migration `0009` — SQLite requires recreating the table to
  drop a NOT NULL constraint, same as any other such change here) — a member created
  this way gets neither, and is structurally unable to log in as a result:
  `authService.login` can only ever find a row by a non-null email, so there's no
  login path to block, rather than one that's explicitly disabled. Everywhere else,
  this kind of member is a completely ordinary `household_members` row — same role,
  same chore assignment, same promote/demote — since every other query keys off
  `userId`, not login status.
* Households have a tree of "zones" (`zones` table, self-referencing via
  `parent_zone_id`) for organizing chores by area later — e.g. "Upstairs" containing
  "Bedroom". Every household gets one root zone (named after the household,
  `parent_zone_id IS NULL`) created alongside it, which can never be removed or
  moved — enforced in `backend/src/services/zoneService.ts`, not the DB, since
  nothing stops a second root at the schema level (root-ness is just "this household's
  one zone with no parent," established once at creation and never re-created).
  Removing a zone cascades to its descendants via `ON DELETE CASCADE` on
  `parent_zone_id` — SQLite chains this recursively as long as `foreign_keys = ON`
  (it is, see `db/client.ts`), so deleting a zone deletes its whole subtree in one
  statement, no application-level recursion needed. Moving (reparenting) a zone
  validates against cycles by walking the subtree of the zone being moved and
  rejecting if the proposed new parent is in it (covers moving into itself too, since
  a zone is a member of its own subtree). View = any member; create/remove/move =
  Head of Household only, same split as the members list. The shared
  "is this user a member / a head of this household" check lives in
  `backend/src/services/membershipAuth.ts`, reused by both `householdService.ts` and
  `zoneService.ts` — put any new household-scoped authorization there rather than
  re-deriving it.
* Chores (`chores` table) record just a `name` — that's it. There used to be a
  `type` (`'single-time'` vs `'forever'`) distinguishing one-off from recurring
  chores, but it never grew any actual behavioral difference and was removed
  (migration `0007` drops the column) — don't reintroduce a type/category field
  unless a real behavioral need for it comes up. A chore's zone assignment is a
  plain many-to-many join table (`chore_zones`) — zero, one, or many zones, no
  constraint either way. Same view/mutate split as members and zones (any member
  views, Head of Household creates), authorized via the same `membershipAuth.ts`
  helpers.
* Chores (and, separately, each chore-zone link) have a `status`:
  `'to-do' | 'complete' | 'overdue'`. All three are settable via the API, but
  `'overdue'` is Head-of-Household only (enforced in `choreService.setChoreStatus` /
  `setChoreZoneStatus`, not the route or a schema refinement) — it's a manual flag for
  now, not yet computed automatically from due dates. Setting `'to-do'` or
  `'complete'` remains "any household member," including completing a chore that's
  currently overdue. A chore with zones takes its status from them, not its own
  `status` column: it's always the lowest-ranked status among its zones (`overdue` <
  `to-do` < `complete`), computed on read in `choreService.deriveChoreStatus` —
  PATCHing a zoned chore's own `/status` endpoint is rejected
  (`ChoreStatusManagedByZones`); only its zones (`/chores/:choreId/zones/:zoneId/status`)
  can be marked. Marking complete is authorized as "any household member," not
  Head-of-Household-only — unlike creating a chore, this was a judgment call
  (completing a chore reads as a routine cooperative action, not an admin one) rather
  than something explicitly specified, so revisit it if that's wrong. The frontend's
  `ChoreStatusActions` component (`frontend/src/components/household/`) is the single
  place that decides which status buttons render for a given status/role — reuse it
  rather than duplicating the to-do/complete/overdue button logic elsewhere.
* Frontend: Vite + React + TypeScript, `react-router` (not `react-router-dom` — v8
  merged the two packages; import from `react-router`) for routing, `vite-plugin-pwa`
  for installability (manifest + service worker).
* Fail fast on missing required config rather than degrading silently — e.g. the
  backend refuses to start without `CORS_ORIGIN` set, because the `cors` package
  treats a falsy `origin` as `*`, which combined with `credentials: true` is a
  fail-open misconfiguration.
* Visual design system lives entirely in `frontend/src/index.css` as CSS custom
  properties on `:root` (palette, type, radius, shadow), with light/dark variants
  under `@media (prefers-color-scheme: dark)`. Don't hardcode colors or fonts in
  component files — reference the tokens (`var(--accent)`, `var(--font-display)`,
  etc.) so a future palette/type change is a one-file edit. The display face
  (`Fredoka`) is self-hosted at `frontend/public/fonts/` — not loaded from a CDN —
  so it works offline once the service worker has precached it; it's included in
  `vite.config.ts`'s `workbox.globPatterns` for that reason, don't drop `woff2` from
  that list.

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
* Run `npm run dev` yourself, or stop processes by pattern-matching the command
  (`pkill -f ...`) — see "If you are Claude Code" above. Use `dev:ai` and stop it by
  port.

## Available scripts

Run from within `backend/` or `frontend/` unless noted:
* `npm run dev` — start that workspace's dev server (human use). From the repo root,
  `npm run dev` starts both via `concurrently`.
* `npm run dev:ai` — same, but on isolated ports/data for Claude Code's own use — see
  the section above. From the repo root, `npm run dev:ai` starts both.
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
  same leak on login/join. `UsernameAlreadyTaken` (409) and `/username-availability`
  have the same existence-leak tradeoff, deliberately, for the same reason.
* No way to change a username after registration, and pre-existing accounts from
  before the username migration got an auto-generated `user-<id>` placeholder instead
  of a real one — there's no UI to fix that up.
* No way to remove an already-*active* member from a household — declining only
  applies to a still-`pending` applicant (see the pending-approval bullet in
  Architectural decisions); once approved, a member is permanent apart from
  promote/demote. Promotion and demotion (head ↔ member) both exist.
* No realtime notification of any kind for the pending-approval flow — a pending
  applicant only finds out they've been approved/declined by clicking "Check again"
  (or reloading/re-logging-in) on `PendingApprovalPage`, and a declined applicant
  gets no email or in-app message explaining why; they just land back on
  `OnboardHouseholdPage` next time.
* Zones can't be renamed after creation — only create/remove/move were asked for.
* Removing a zone cascades to everything nested inside it, with no undo — an inline
  "are you sure" confirmation guards this in the UI, but there's no soft-delete or
  recovery if someone confirms by mistake.
* Chores can be created, removed, assigned/unassigned (many-to-many, any chore), and
  marked to-do/complete/overdue, but not edited yet. Removal is Head of Household only
  (same split as create), guarded by an inline "are you sure" confirmation in the UI
  (same pattern as zone removal) rather than a soft-delete — no undo if confirmed by
  mistake. There's no chore detail view either, just the flat list on the home page;
  anything richer (filtering by zone, editing) is future work, along with computing
  `'overdue'` automatically from due dates once those exist (it's manually
  head-settable in the meantime — see the chores bullet in Architectural decisions).

Fixed during the UI pass: the household's join code was generated and stored but
never returned by the API, so there was no way to actually invite anyone into a
household you'd created. `PublicHousehold` (backend) and `Household` (frontend) now
include `joinCode`; it's shown on the home page as the "stamp." A household's own
join code is safe to show to any of its members — it's not treated as a secret from
them, only from outsiders.

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