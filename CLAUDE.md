# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A production-line logging system for a knife-sharpening shop (ลับมีด). Operators check out a machine, start a work order (lot), run tuning rounds / stone changes during the shift, and check out the log with final quantities and defect counts. It's a learning project (comments in `backend/src` are written in Thai by the author to explain NestJS/Prisma/Postgres concepts to themselves) — treat in-code Thai comments as valuable context, not boilerplate to strip.

This is a single git repository at the project root, covering `backend/`, `frontend/`, `database/`, and `ts-practice/` together (previously untracked).

## Structure

```
MyProductionSystem/
├── backend/       NestJS + Prisma + PostgreSQL API (port 3001)
├── frontend/      Next.js App Router UI (port 3002)
├── database/      Hand-written raw SQL (001_init_schema.sql, 002_seed_data.sql) — the original schema source before Prisma introspection
├── docker-compose.yml   Local Postgres 16 container
└── ts-practice/   Unrelated TypeScript sandbox for practicing syntax — not part of the app, ignore unless asked
```

## Commands

### Database
The backend points at a Neon-hosted Postgres instance (`backend/.env` `DATABASE_URL`) — no local database needs to be running for normal development. `docker-compose.yml` still exists for an offline/local fallback (`docker-compose up -d`, localhost:5432) but isn't the default anymore.

`backend/scripts/migrate-gsheet-history.ts` is a one-time (idempotent, safe to re-run) migration that imported the pre-app production history from the old Google Sheets ("PD-CS-SG-01 REV.001" / "PD-CS-SG-02 REV.001") into Neon — 691 production-log rows plus the small inventory dataset. Source CSV lives at `database/source-data/sg01_production_log.csv`. Defaults to a dry run (`npx tsx scripts/migrate-gsheet-history.ts`); pass `--commit` to actually write. Keep it around as the record of where the historical data came from and the name-normalization decisions made during import (see `NAME_ALIASES` in the script).

`database/001_init_schema.sql` and `002_seed_data.sql` are kept in sync with `schema.prisma` and are what was run against Neon to provision it (via `npx prisma db execute --file <path>` from `backend/`, since `psql` isn't required). If you hand-edit the schema, keep the SQL files and `schema.prisma` from drifting apart — a stale `001_init_schema.sql` previously caused a real bug (missing `started_at` column, wrong NOT NULL constraints, missing the `one_in_progress_per_machine` partial unique index) that only surfaced at runtime, not at build time.

### Backend (`backend/`)
```bash
npx nest start --watch        # http://localhost:3001 — no npm script alias exists for this, call nest directly
npx prisma generate           # regenerate client into backend/generated/prisma after schema.prisma changes
npx prisma db pull            # introspect DB → schema.prisma (this is how the schema has been kept in sync so far)
```
There is **no test runner configured** — `npm test` is a stub that exits with an error. "Tests" in this repo are ad hoc scripts run manually against a running dev server:
- `test-start.ps1`, `test-checkout.ps1`, `test-post.ps1` — PowerShell scripts that POST/PATCH to the API and pretty-print success/error responses. Call with a `-Body @{...}` hashtable.
- `test-concurrent.js`, `test-concurrent-checkout.js` — Node scripts that fire parallel requests to exercise the machine-lock and row-lock concurrency logic.
- `test-prisma.ts` — scratch script for Prisma Client, run via `tsx`.

There are **no Prisma migrations** (`backend/prisma/migrations/` does not exist). The schema was built via `database/*.sql` directly against Postgres, then captured into `schema.prisma` with `prisma db pull`. If you need schema changes, either hand-write SQL and re-run `db pull`, or introduce `prisma migrate` deliberately (that's a workflow change, confirm with the user first).

### Frontend (`frontend/`)
```bash
npm run dev                   # next dev -p 3002
npm run build
npm run lint
```

### Deployment (Vercel)

Both apps deploy to Vercel as separate Projects from this one repo (Root Directory = `backend` / `frontend` respectively). After one-time setup below, redeploying both is a single command from the repo root:

```bash
npm run deploy                # vercel deploy backend --prod, then frontend --prod
```

**One-time setup, in order:**
1. `vercel login` (interactive, opens a browser).
2. `npm run deploy` once — with no linked project yet, `vercel deploy --yes` auto-creates and links a new Vercel Project for each of `backend/` and `frontend/`, using the directory name. Note the two assigned `*.vercel.app` URLs it prints.
3. Set env vars per project (Vercel dashboard → Project → Settings → Environment Variables, or `vercel env add NAME production` from inside that directory):
   - **backend project**: `DATABASE_URL` (the Neon connection string from `backend/.env`), `CORS_ORIGINS` (comma-separated; must include the frontend's `*.vercel.app` URL from step 2).
   - **frontend project**: `NEXT_PUBLIC_API_URL` (the backend's `*.vercel.app` URL from step 2).
4. `npm run deploy` again so both sides pick up the env vars set in step 3.

The backend runs on Vercel as a serverless function, not `app.listen()` — see `backend/api/index.ts` (the Vercel entrypoint, wraps the Nest app with `ExpressAdapter` and caches the bootstrapped app across warm invocations) and `backend/vercel.json` (rewrites every path to that function). `backend/src/bootstrap.ts` holds the ValidationPipe/exception-filter/CORS setup shared between `src/main.ts` (local dev, `app.listen(3001)`) and `api/index.ts` (serverless, `app.init()`) — edit shared request-handling config there, not in either entrypoint. `postinstall`/`vercel-build` both run `prisma generate` since the generated client isn't committed (gitignored) and Vercel's function bundler needs it on disk before bundling `api/index.ts`.

## Architecture

**Domain model** (see `database/001_init_schema.sql` for the clearest annotated view, `backend/prisma/schema.prisma` for the Prisma-generated version — they describe the same schema):
- `production_logs` is the core table: one row per work order (machine + knife + lot, `status` of `in_progress`/`completed`).
- Three child tables hang off `production_logs.id` via FK cascade-delete: `stone_changes` (0 or 1 per log), `tune_rounds` (0 or many), `defect_entries` (0–15 per log, one per `defect_types.code`).
- `good_qty` is never stored — it's derived (`total_qty - SUM(defect_entries.qty)`) via the `production_logs_summary` SQL view.
- A partial unique index (`one_in_progress_per_machine`, on `production_logs.machine_id` where `status = 'in_progress'`) enforces that a machine can only have one open work order at a time — this is a DB-level constraint, not just app logic.
- A `lot_no` that already has a `completed` log can't be reused to start a new work order (`startWorkOrder` in `production-logs.service.ts` checks this inside the same transaction as the machine-lock check, before insert). `GET /production-logs/lot-check?lotNo=...` is a read-only sibling of that same check, used by `frontend/app/start/page.tsx` for live (debounced) feedback before the operator even attempts to submit — the server-side check in `startWorkOrder` is what's actually load-bearing; the live check is just UX, not the enforcement point.

**Concurrency control** (`backend/src/production-logs/production-logs.service.ts`): starting a work order takes a Postgres advisory lock (`pg_advisory_xact_lock`, namespace `42` + machine id) inside a transaction before checking/creating, to serialize concurrent "start" requests on the same machine ahead of the unique-index check. Checkout takes a row lock (`SELECT ... FOR UPDATE`) on the target `production_logs` row before validating status, so two simultaneous checkouts on the same log can't both succeed. When touching this file, preserve these lock-then-check patterns — removing them reopens race conditions the tests in `test-concurrent*.js` are there to catch. Full walkthrough (why each lock exists, what breaks without it, how to run the negative-control test): [`CONCURRENCY.md`](CONCURRENCY.md).

**Audit trail** (`production_logs.version` + `production_log_history`, added 2026-07-30 — see `AUDIT_TRAIL_PLAN.md` and `AUDIT_TRAIL_AND_HISTORY_PAGE_PLAN.md` for the full design): `PATCH /production-logs/:id` lets already-completed logs be corrected after the fact (e.g. a miscounted `total_qty`). There's no auth, so the caller supplies `editedBy` (a plain name string picked from a dropdown client-side) plus a required-by-UI `editReason`. `ProductionLogsService.updateLog()` takes the same `SELECT ... FOR UPDATE` row-lock pattern as `checkoutWorkOrder`, snapshots the entire pre-edit row as JSONB into `production_log_history` inside the same transaction, then updates and increments `version` — snapshot-then-update, both operations atomic. `GET /production-logs/:id/history` returns the full edit trail for a log, newest first. Both are `:id`-shaped routes and must stay declared after the static routes in the controller. Only `total_qty`/`operator_id`/`supervisor_id` are editable — machine/knife/lot/dates are deliberately immutable (wrong values there mean the wrong *record*, not a wrong field). No undo/rollback endpoint and no field-level diff UI — see each plan's "สิ่งที่ยังไม่ต้องทำ" for what was deliberately deferred.

**`/records` page** (`frontend/app/records/page.tsx`): the UI for the audit trail above — a paginated, filterable table of completed logs (machine / operator / date-range filters, 20 per page), where clicking a row opens an edit modal that calls `PATCH /production-logs/:id`. Backed by `GET /production-logs/records` (`ProductionLogsService.getRecords()`), which is **separate from** `GET /production-logs/analytics`: `analytics` returns every row unfiltered for client-side aggregation, `records` filters and paginates server-side because it's a browse-and-edit table. Rows with `version > 1` show an amber "แก้ไขแล้ว ×N" badge. This page is Tailwind-on-DESIGN.md-tokens (like `start`), not the older inline-style pattern `checkout` still uses.

**Prisma client is non-default**: generated to `backend/generated/prisma` (not `node_modules/@prisma/client`), using the `@prisma/adapter-pg` driver adapter (see `PrismaService`). Import from `../generated/prisma/client`, not `@prisma/client`. Regenerate with `npx prisma generate` after any `schema.prisma` edit.

**Relation naming gotcha**: `production_logs` has two FKs to `employees` (`operator_id`, `supervisor_id`), so Prisma auto-generates disambiguated relation field names like `employees_production_logs_operator_idToemployees`. These names are load-bearing in both `production-logs.service.ts` and `frontend/lib/api.ts` types — don't try to rename them without regenerating and updating both sides.

**Error handling**: two global exception filters registered in `main.ts` — `PrismaExceptionFilter` maps known Prisma error codes (P2002 unique violation → 409, P2003 FK violation → 400, P2025 not found → 404) to Thai-language JSON error bodies; `AllExceptionsFilter` is the catch-all fallback for anything else → 500. Global `ValidationPipe` runs with `whitelist`, `forbidNonWhitelisted`, and `transform` all enabled, so DTOs are the single source of truth for what a request body may contain.

**Frontend/backend contract**: `frontend/lib/api.ts` is a hand-maintained typed fetch wrapper — there's no codegen from the backend DTOs, so when a backend DTO shape changes, update the matching type in `lib/api.ts` by hand. CORS in `main.ts` is locked to `http://localhost:3002` (the frontend dev port) plus `GET/POST/PATCH/DELETE/OPTIONS`.

**Route ordering**: in `production-logs.controller.ts`, static routes must be declared before parameterized ones on the same path prefix (e.g. `start` before `:id/checkout`) or Nest will try to match the param route first. Keep this ordering in mind when adding new endpoints under `production-logs`.

**Reference data has no admin API, but the frontend reads it live**: `employees`, `machines`, `knives`, and `defect_types` have no create/update endpoints — adding one still means inserting a row directly in Postgres. What changed (2026-07-30): `start/page.tsx` and `checkout/page.tsx` used to duplicate these tables as hardcoded arrays (`frontend/lib/employees.ts`, a `MACHINES`/`KNIVES` const, `frontend/lib/defect-types.ts`) that had to be hand-edited and redeployed every time a row was added — that's gone. Both pages now call `GET /production-logs/config` (`ProductionLogsService.getConfig()`) on load and render whatever's actually in the DB, the same way `inventory/page.tsx` already did for `item_master` via `GET /inventory/items`. So: a new employee/machine/knife/defect_type is a **DB insert only** now — no code change, no redeploy, it just shows up next page load. Full how-to for non-engineers: [`MANAGER_GUIDE.md`](MANAGER_GUIDE.md).

## Design Context

`PRODUCT.md` and `DESIGN.md` at the project root capture the frontend's strategic and visual design system (via the `impeccable` skill under `.claude/skills/impeccable`). Read both before making UI changes to `frontend/`: PRODUCT.md covers register/users/purpose/principles, DESIGN.md is the canonical token/component spec ("The Shift Log" — graphite surfaces, Shift Blue accent, confirm/warn/alert status tiers). Note that `start/page.tsx` and `dashboard/page.tsx` still use the older Tailwind neutral/emerald theme and haven't been migrated onto the DESIGN.md palette yet — `checkout/page.tsx` is the closest to canonical.
