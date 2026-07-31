# Handoff / Session Notes — Blacksmith Production System

> Paste this file (or say "read HANDOFF.md") at the start of a new AI session.
> Works with **Claude Code** (also auto-reads `CLAUDE.md`) and **Gemini CLI**
> (auto-reads `GEMINI.md` if present — this file is the manual handoff for both).
> Last updated: 2026-07-30.

---

## ⚠️ READ THIS FIRST — audit trail is uncommitted, and Neon now has real historical data

**Items 1–10 of the 2026-07-30 session are committed (`901ecf4`) and deployed to Vercel.**
**Item 11 (audit trail + `/records`) is written and verified locally but NOT committed and
NOT deployed** — though **its schema change is already live on Neon** (`version` column +
`production_log_history` table), so production DB is ahead of production code. That's safe
in this direction (the new column has a default, nothing reads the new table yet), but
don't leave it half-way for long. `git status` currently shows:
```
M  .claude/settings.json, CLAUDE.md, HANDOFF.md, MANAGER_GUIDE.md,
   backend/prisma/schema.prisma, backend/src/production-logs/production-logs.{controller,service}.ts,
   database/001_init_schema.sql, frontend/app/page.tsx, frontend/lib/api.ts
?? AUDIT_TRAIL_PLAN.md, AUDIT_TRAIL_AND_HISTORY_PAGE_PLAN.md,
   backend/src/production-logs/dto/{records-query,update-production-log}.dto.ts,
   backend/test-edit.ps1, backend/test-concurrent-edit.js,
   database/005_audit_trail_schema.sql, frontend/app/records/
```
Don't split this up without checking with the repo owner first — they've been deliberately
hands-on with review, and they run all DB-writing and deploy commands themselves.

**More important than the git state: production Neon now holds real historical data.**
691+ real production-log rows were migrated from the shop's old Google Sheets
("PD-CS-SG-01 REV.001" / "PD-CS-SG-02 REV.001") via `backend/scripts/migrate-gsheet-history.ts`,
and `employees`/`machines`/`knives` were fully reset (`TRUNCATE ... RESTART IDENTITY CASCADE`)
and rebuilt around that migration. **Do not treat this DB as disposable seed data anymore** —
the old assumption ("just re-run 002_seed_data.sql if something looks wrong") no longer
holds; that file's employee list (includes รัตนา, doesn't include the `active` column) is
now stale relative to what's actually in Neon. See "Key gotchas" below before touching
reference-table rows.

**The manager (repo owner) has explicitly asked to drive DB-writing commands themselves**
going forward — prepare/verify (dry-runs, SELECT checks), hand them the exact command, let
them run it. This came up hard mid-session; don't relearn it the hard way.

---

## What this project is

Shop-floor production logging for a knife-sharpening business (ลับมีด). Operators
**start** a work order (machine + knife + lot), then **checkout** with quantities,
defects, stone changes, tuning rounds. A dashboard shows in-progress work.
Full detail in `CLAUDE.md` (architecture) and `PRODUCT.md` / `DESIGN.md` (design system).

Stack: **NestJS + Prisma** backend, **Next.js (App Router)** frontend, **Neon Postgres** DB.

---

## Live URLs & infrastructure

| Thing | Value |
|---|---|
| Frontend (prod) | https://blacksmith-v1.vercel.app |
| Backend API (prod) | https://blacksmith-app-v1.vercel.app |
| GitHub repo | https://github.com/kampagriculture-cmyk/blacksmith-app-v1 |
| Database | Neon Postgres (region ap-southeast-1) — connection string in `backend/.env` (gitignored) |
| Vercel — frontend project | `blacksmith-v1` (Root Directory = `frontend`) |
| Vercel — backend project | `blacksmith-app-v1` (Root Directory = `backend`) |

**Env vars set on Vercel** (both marked Sensitive, can't be read back via CLI):
- backend `blacksmith-app-v1`: `DATABASE_URL`, `CORS_ORIGINS` (= `https://blacksmith-v1.vercel.app,http://localhost:3002`)
- frontend `blacksmith-v1`: `NEXT_PUBLIC_API_URL` (= `https://blacksmith-app-v1.vercel.app`)

---

## What was done this session (2026-07-30)

1. **`CONCURRENCY.md` added** — full walkthrough of the advisory-lock/row-lock
   patterns in `production-logs.service.ts` (companion to the summary in `CLAUDE.md`),
   including how to run the `test-concurrent*.js` negative control.
2. **`MANAGER_GUIDE.md` added** (then substantially rewritten mid-session, see #5) —
   non-engineer runbook for adding operators/machines/knives/defect-types/materials.
3. **Migrated real production history from the shop's old Google Sheets into Neon.**
   - Source: "PD-CS-SG-01 REV.001" (691→696→ final row count, kept growing as the
     shop kept using the sheet live during migration) and "PD-CS-SG-02 REV.001"
     (inventory: 7 withdrawals, 1 receipt, 2 materials).
   - Built `backend/scripts/migrate-gsheet-history.ts` — idempotent, defaults to
     dry-run, `--commit` to write. Reads `database/source-data/sg01_production_log.csv`
     (committed for provenance) — no live Google API calls from the script itself, the
     CSV was pulled once per re-sync via this session's Drive tool access.
   - Along the way: normalized several operator name variants that had accumulated in
     the sheet (`ส้ม`→`สุชาดา`, `...(เต้)`→`เต้`, etc. — see `NAME_ALIASES` in the
     script), caught and fixed 19 rows where a mid-migration correction
     (`ปิยะดา`→`ปรียะดา`) landed in the sheet *after* an initial `--commit` had already
     run — the script's dedup key (machine+lot+ended_at) doesn't cover operator
     identity, so a second run silently skipped them; fixed directly via
     `backend/scripts/fix-operator-attribution.ts` (kept as an incident record, not
     meant to be re-run).
4. **Full DB reset + clean re-migration**, done by the repo owner directly (not by
   Claude — see the standing rule about DB-writing commands): `TRUNCATE ... RESTART
   IDENTITY CASCADE` on every table, reseed via `database/004_reset_reference_data.sql`,
   then `migrate-gsheet-history.ts --commit`. Employee รัตนา was intentionally *not*
   in this reseed's original-5 (she resigned; ภาวิณี took her `002_seed_data.sql`-era
   slot) — she still exists as an employee (auto-created from her historical rows) so
   old logs display correctly, just isn't part of the pre-seed anymore.
   **`database/002_seed_data.sql` is now stale relative to `004_reset_reference_data.sql`**
   (different employee list, no `active` column) — don't use 002 as a reset reference
   without checking 004 first.
5. **Removed the frontend-hardcoded reference-data problem entirely.** `start/page.tsx`
   and `checkout/page.tsx` used to import fixed arrays (`frontend/lib/employees.ts`,
   a `MACHINES`/`KNIVES` const, `frontend/lib/defect-types.ts`) that had to be
   hand-edited + redeployed every time a row was added in the DB. Added
   `GET /production-logs/config` (`ProductionLogsService.getConfig()`) returning live
   `employees`/`machines`/`knives`/`defectTypes`; both pages now fetch it on load
   (loading/error states included). The two hardcoded lib files are deleted.
   `CLAUDE.md` and `MANAGER_GUIDE.md` rewritten accordingly — adding reference data is
   a **DB insert only** now, no code/redeploy step, matching how `item_master` always
   worked.
6. **Added `employees.active` (boolean, default `true`)** — done by the repo owner via
   Neon console, then `npx prisma db pull` + `npx prisma generate` to sync
   `schema.prisma`/the generated client, then `getConfig()`'s employees query got
   `where: { active: true }` added so inactive people (e.g. resigned รัตนา) drop out
   of the Start/Checkout dropdowns without breaking their historical logs.
   `database/001_init_schema.sql`'s `employees` table definition updated to match.
   **No equivalent flag exists yet for `machines`/`knives`/`defect_types`** — same
   gap, not yet needed, documented in `MANAGER_GUIDE.md` §1.
7. **Debugged a stale-process bug** (Claude's own mistake): an orphaned
   `node dist/src/main` process survived a `pkill -f "nest start"` from earlier
   testing and squatted on port 3001 for ~50 minutes, serving pre-`active`-column code
   no matter how many times the repo owner restarted their own dev server. Killed via
   `taskkill //PID <pid> //F` once found via `netstat`/`Get-CimInstance Win32_Process`.
   Worth checking `netstat -ano | grep :3001` if the backend ever seems to be ignoring
   changes despite a clean restart.

8. **Built the analytics dashboard** (`/analytics`) — ported wholesale from the shop's
   old Google Apps Script dashboard (the owner pasted its HTML/JS in chat). KPIs, A/B
   compare mode, Pareto defect chart, stone-lifespan chart, daily-trend chart with
   user-defined comparison series, and a daily table flagging stone changes / operator
   swaps / unassigned machines. Backed by two new endpoints: `GET /production-logs/analytics`
   (every completed row, unfiltered — the page aggregates client-side exactly like the
   original did) and `GET /production-logs/machine-owners`. Only the data-fetch layer
   changed (`google.script.run` → `fetch`) plus column-index magic numbers → named fields.
   Added `chart.js` as a real dependency (the original used a CDN `<script>`).
9. **Committed + deployed everything above** — commit `901ecf4`, pushed to GitHub, then
   deployed both Vercel projects. Verified live: `/production-logs/config` correctly
   excludes inactive รัตนา, `/production-logs/analytics` returns all 695 rows,
   `/analytics` page renders.
10. **Fixed a real downtime bug found during review**, then extended the feature: the
    owner questioned a "3h28m" July SG-01 downtime figure. Investigation showed the
    formula (`stone-change time + tuning time`) was right but `tune_rounds` was **empty
    for all 695 rows** — the original migration had folded tuning info into `remark` as
    free text. Of 148 rows with `"จูน:"` in remark, only 10 held a real parseable time
    range (the other 138 were literally `"จูน:  (0 นาที)"`); `backend/scripts/backfill-tune-rounds.ts`
    recovered those 10 (idempotent, validates stated-vs-computed minutes before writing).
    Also split the Downtime KPI to show **เปลี่ยนหิน% vs จูน%** of total downtime.
11. **Audit trail + `/records` page** (per `AUDIT_TRAIL_PLAN.md`, then the expanded
    `AUDIT_TRAIL_AND_HISTORY_PAGE_PLAN.md`):
    - Schema: `production_logs.version` + `production_log_history` (JSONB snapshot,
      `edited_by`, `edit_reason`) — `database/005_audit_trail_schema.sql`, run on Neon by
      the owner, mirrored into `001_init_schema.sql`.
    - `PATCH /production-logs/:id` — snapshot-then-update inside one transaction, using
      the same `FOR UPDATE` row lock as `checkoutWorkOrder`. `GET /production-logs/:id/history`
      returns the trail. Test scripts: `backend/test-edit.ps1`, `backend/test-concurrent-edit.js`
      (⚠ the concurrent one mutates whatever `LOG_ID` is set at the top — pick a throwaway log).
    - `GET /production-logs/records` — paginated + server-filtered list (deliberately
      separate from `/analytics`, which is unfiltered-everything for client-side math).
    - `frontend/app/records/page.tsx` — the browse-and-correct table + edit modal, on
      Tailwind/DESIGN.md tokens. Amber "แก้ไขแล้ว ×N" badge on corrected rows.
    - Decided during build: the "แก้ไขโดย" dropdown lists **all roles**, not just
      supervisors — there's no auth, so restricting it would be theater, not a control.

**Not yet done for the audit-trail feature:** the owner hasn't run `test-edit.ps1` /
`test-concurrent-edit.js` yet, and none of item 11 is committed or deployed.

---

## What was done this session (2026-07-17 → 18)

1. Created `CLAUDE.md`, initialized a single git repo, pushed to GitHub.
2. Migrated DB from local Docker Postgres → **Neon**. Applied `database/001_init_schema.sql`
   + `002_seed_data.sql`.
3. **Fixed a real schema-drift bug on Neon**: the SQL file was stale — was missing the
   `started_at` column, had wrong `NOT NULL` constraints, and was missing the
   `one_in_progress_per_machine` partial unique index. Fixed on Neon + corrected the SQL file.
4. Ran `impeccable init` → created `PRODUCT.md`, `DESIGN.md`, `.impeccable/`. Design system
   is **"The Shift Log"**: graphite dark surfaces + Shift Blue accent + confirm/warn/alert tiers.
5. Polish pass: added `BackLink` component + back links on all screens, retheme of
   home/start/dashboard onto the DESIGN.md palette, real loading states, dashboard refresh
   button + tab-visibility-aware polling, restored input focus outlines.
6. **Vercel deploy prep**: wrapped NestJS as a serverless function
   (`backend/api/index.ts` + `backend/src/bootstrap.ts` + `backend/vercel.json`),
   added `postinstall`/`vercel-build` → `prisma generate`, `.env.example` files.
7. Deployed both to Vercel. Fixed a **CORS error** (backend `CORS_ORIGINS` didn't include
   the frontend origin).
8. **New feature — lot duplicate check**: can't start a work order with a `lot_no` that's
   already `completed` OR currently `in_progress` on another machine. Backend enforces it in
   `startWorkOrder` (transactional); `GET /production-logs/lot-check?lotNo=` powers a live
   debounced check on the start page (disables the button + shows a Thai warning).
9. Reseeded the 5 sample `production_logs` rows on Neon (they'd been cleared by testing).

---

## Suggested next steps (not yet done)

- [ ] **Immediate**: run `backend/test-edit.ps1` and `backend/test-concurrent-edit.js`
      against the audit-trail endpoints, review `/records` in the browser, then commit +
      deploy item 11 (backend first, then frontend). Nothing from item 11 is committed yet.
- [ ] Show the full edit-history timeline in the `/records` modal (who changed what, from
      what value to what) — the data is all in `production_log_history`, the UI just shows
      a version count today. Deliberately deferred in the plan as "phase ถัดไป".
- [ ] Migrate `frontend/app/checkout/page.tsx` from its hand-rolled inline-style theme
      (the `V`/`S` objects) onto the Tailwind Shift Log tokens the other pages now use.
      It works and uses the same colors, but it's the last screen not on the shared system.
      Run `/impeccable polish checkout` (Claude Code) when ready.
- [ ] Decide on the deploy story: either run `vercel link` in `backend/` and `frontend/`
      so `npm run deploy` works, or keep deploying via the CLI command below. Also decide
      whether GitHub-push-auto-deploy should be the source of truth (if so, always push
      before relying on it).
- [ ] Consider adding an `active` boolean to `machines`/`knives`/`defect_types` too,
      matching what `employees`/`item_master` now have — same "resigned employee still
      in the dropdown" class of problem will eventually hit a retired machine or
      discontinued knife size.

---

## How to run locally

```bash
# DB: nothing to start — backend points at Neon via backend/.env

# Backend (port 3001) — note: no npm alias, call nest directly
cd /c/Dev/MyProductionSystem/backend
npx nest start --watch

# Frontend (port 3002)
cd /c/Dev/MyProductionSystem/frontend
npm run dev
```
`frontend/.env.local` currently points at `http://localhost:3001` (local backend).
No test runner exists (`npm test` is a stub); "tests" are the ad-hoc `backend/test-*.ps1`
and `test-concurrent*.js` scripts run against a live server.

## How to deploy (current working method)

Projects aren't linked locally (`.vercel/` dirs don't exist), so use the `--project` flag
from the repo root — Vercel applies each project's configured Root Directory:
```bash
cd /c/Dev/MyProductionSystem
npx vercel deploy --prod --yes --project blacksmith-app-v1   # backend
npx vercel deploy --prod --yes --project blacksmith-v1       # frontend
```
(The root `package.json` `npm run deploy` script assumes linked projects and won't work
until `vercel link` is run — see next-steps.)

---

## Key gotchas (things that will bite you)

- **Prisma client is generated to `backend/generated/prisma`** (not `node_modules`), is
  gitignored, and uses the `@prisma/adapter-pg` driver. Run `npx prisma generate` after any
  `schema.prisma` change. Import from `../generated/prisma/client`.
- **Weird relation field names** like `employees_production_logs_operator_idToemployees`
  are Prisma auto-generated (two FKs to `employees`). Don't rename them; they're used in
  both backend and `frontend/lib/api.ts`.
- **Route order matters**: in `production-logs.controller.ts`, static routes (`start`,
  `in-progress`, `lot-check`) must come before `:id/checkout`.
- **DB-level invariants** (not just app logic): one in-progress log per machine
  (partial unique index), and lot-no can't be reused if completed/in-progress.
- **Serverless split**: shared request setup (validation, filters, CORS) lives in
  `backend/src/bootstrap.ts`, used by both `src/main.ts` (local) and `api/index.ts` (Vercel).
  Edit shared config there, not in either entrypoint.
