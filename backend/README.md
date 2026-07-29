# chore-tracker backend

Express + TypeScript API that records chore and household info. Auth is email +
password with server-side sessions (see `../CLAUDE.md` for the architectural
decisions behind these choices).

## Prerequisites

- Node.js 20+
- npm

## First-time setup

```sh
npm install
cp .env.example .env
```

`.env` is gitignored and never committed — edit it if you need a different port, CORS
origin, or session lifetime. `CORS_ORIGIN` must be set or the server refuses to start
(see `src/app.ts`).

## Running it

```sh
npm run dev
```

This starts the API on `http://localhost:3001` (or whatever `PORT` is set to) and
applies any pending database migrations automatically on startup — no separate
migrate step is needed for local development. The SQLite database file is created at
the path in `DB_FILE` (default `./data/chore-tracker.db`) the first time it runs.

To run the whole app (backend + frontend) together, use `npm run dev` from the repo
root instead.

**If Claude Code is running this for its own testing**, it uses `npm run dev:ai`
instead (port 4001, a separate `chore-tracker.ai.db`) so it never collides with or
reads/writes over a human's own dev server or data. See `../CLAUDE.md`.

## Other scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build (`dist/index.js`) |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm test` | Run the test suite (Vitest) |
| `npm run db:generate` | Generate a new migration from `src/db/schema.ts` after changing it |
| `npm run db:migrate` | Apply migrations without starting the server |
| `npm run dev:ai` | Same as `dev`, but on port 4001 with its own `chore-tracker.ai.db` — for AI-agent use, not humans |

## Project layout

```
src/
  db/          Drizzle schema, migrations, and the SQLite client
  services/    Business logic (auth, password hashing, session/join-code generation)
  validation/  zod request schemas
  middleware/  Express middleware (auth guard, error handler)
  routes/      Route handlers
  app.ts       Express app wiring (no side effects, used by tests)
  index.ts     Process entry point (runs migrations, starts the server)
```
