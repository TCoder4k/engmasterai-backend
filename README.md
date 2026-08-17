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
- **Resolved: full e2e run hanging after all tests passed.** Root-caused via
  bisection (not `--detectOpenHandles`, whose own forced-GC handle-collection
  pass proved unreliable in this environment and never printed a report — a
  separate, cosmetic Jest/Windows quirk, not the leak itself) and fixed by
  two changes:
  - `PrismaService` (`src/prisma/prisma.service.ts`) and `SharedRedisModule`
    (`src/shared/redis/redis.module.ts`) had no `OnModuleDestroy` hook, so
    `app.close()` never released the Prisma connection or the ioredis
    client/reconnect timer. Every e2e file compiles its own `AppModule`, so
    a full run leaked one of each per file. Fixed by disconnecting both on
    `onModuleDestroy` — `SharedRedisModule` deliberately uses
    `redis.disconnect()`, not `.quit()`: `quit` is sent as a normal Redis
    command, so against an unreachable Redis (see `auth.e2e-spec.ts`'s
    "Redis outage" suite) it would sit in the offline queue forever waiting
    for a connection that never comes.
  - `test/app.e2e-spec.ts` built its Nest app in `beforeEach` but had no
    matching `afterEach` — the only e2e file that never called
    `app.close()` at all. Alone, a single un-closed app didn't reproduce the
    hang (nothing forced Node to notice); paired with any second file in the
    same worker process, it did. Fixed by adding the missing `afterEach`.
  Verified via bisection down to a 2-file minimal repro (`app` + `auth`),
  confirmed fixed there, then re-confirmed on the full 24-file suite: exits
  naturally, exit code 0, no "did not exit" warning.
