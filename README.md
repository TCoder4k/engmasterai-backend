# EngMasterAI Backend

NestJS + TypeScript + Prisma/PostgreSQL + Redis backend for EngMasterAI.

## Project setup

```bash
npm install
docker compose up -d          # local Postgres + Redis
cp .env.example .env          # fill in real values
cp .env.test.example .env.test
npx prisma generate
npx prisma migrate deploy
```

## Compile and run

```bash
npm run start:dev             # watch mode
npm run build && npm run start:prod
```

## Tests

```bash
npm test                      # unit — see "Test database" below
npm run test:e2e              # e2e — see "Test database" below
npm run lint:check            # CI lint gate (no --fix)
npm run lint                  # local dev convenience (--fix)
```

### Test database

Both `npm test` and `npm run test:e2e` share the same Jest `globalSetup`/
`globalTeardown` (`test/jest-global-setup.ts`), which runs `prisma migrate
deploy` against `DATABASE_URL` from `.env.test` and refuses to run unless
that database name ends in `_test` (see `test/test-database.util.ts`) — this
guard exists because test fixtures once leaked into the development database
(see `docs/memory.md` in the project root workspace). So several "unit"
specs are really integration tests against a real Postgres + Redis.

`.env.test.example` is the single source of truth for which env vars a test
run needs — copy it, don't hand-roll a `.env.test`. Notably, do **not** set
`REDIS_HOST`/`REDIS_PORT` there: leaving them unset lets `redis.module.ts`'s
own `localhost:6379` default apply, which a Redis-outage e2e suite depends on
(it mutates `process.env.REDIS_HOST` at runtime and expects the default to
still resolve correctly).

## CI contract

`.github/workflows/ci.yml` runs on every push/PR to `main`:

```
checkout → setup Node (from package.json "engines") → npm ci
  → prisma generate
  → .env.test.example → cp → override DATABASE_URL/JWT_SECRET for the job's
    Postgres/Redis service containers (never re-declares the whole file —
    add a new required var to .env.test.example and CI picks it up for free)
  → npm run build
  → npm run lint:check   (non-blocking, see "Known CI debt")
  → npm test
  → npm run test:e2e
```

Postgres (`postgres:13.5`) and Redis (`redis:7-alpine`) run as GitHub Actions
service containers for the whole job, matching `docker-compose.yml`'s local
versions. `build`, `test`, and `test:e2e` are hard gates — a failure there
fails the job. There is no `continue-on-error`, `|| true`, or disabled suite
anywhere except the one lint step below.

### Known CI debt

- **Lint (91 pre-existing errors, tracked, not yet fixed).** `lint:check`
  runs on every CI run and is visible in the job log/UI, but is currently
  `continue-on-error: true` so it does not fail the build. The errors are
  concentrated in a handful of files where a third-party dependency has weak
  or missing types (Cloudinary SDK + `buffer-to-stream`, `passport-jwt`,
  spreadsheet/CSV parsing in `vocab-import`) — fixing them needs real type
  modeling per external API, not a mechanical change. Re-run
  `npm run lint:check` locally for the current count; do not silently let it
  grow, but it isn't a merge blocker yet.
- **`test/jest-e2e.json` runs e2e serially (`maxWorkers: 1`) on purpose.**
  Multiple e2e suites share one Postgres test database; running them in
  parallel let one suite observe another suite's in-flight (not yet
  cleaned-up) fixtures and fail a "no stray content" guard. Serial execution
  trades speed for determinism — a full e2e run now takes several minutes
  instead of ~70s. Do not re-enable parallel workers to make CI faster
  without re-solving the underlying cross-suite isolation problem.
- **"Jest did not exit one second after the test run has completed"** /
  "A worker process has failed to exit gracefully" appears on every Jest run
  (unit and e2e alike). Jest force-exits after printing it and the process
  still exits 0 — it does not hang CI — but it indicates something (likely a
  Prisma or Redis client) isn't being closed in a teardown hook somewhere.
  Not yet root-caused; a candidate for a future `--detectOpenHandles` pass.
