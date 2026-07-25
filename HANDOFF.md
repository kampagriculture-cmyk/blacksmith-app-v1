# Handoff / Session Notes — Blacksmith Production System

> Paste this file (or say "read HANDOFF.md") at the start of a new AI session.
> Works with **Claude Code** (also auto-reads `CLAUDE.md`) and **Gemini CLI**
> (auto-reads `GEMINI.md` if present — this file is the manual handoff for both).
> Last updated: 2026-07-18.

---

## ⚠️ READ THIS FIRST — repo is behind production

There are **9 uncommitted local changes**, and **GitHub only has the initial commit**.
The lot-duplicate-check feature is **live on Vercel** (deployed from local via CLI) but
**not yet on GitHub**. So GitHub `main` is *behind* what's actually deployed.

**First action when back:** commit + push the local changes so GitHub matches production.
```bash
cd /c/Dev/MyProductionSystem
git status              # confirm the 9 changes below
git add -A
git commit -m "Add lot-duplicate check, Vercel env examples, docs"
git push
```
Uncommitted changes are: `lot-check` feature (backend service/controller + frontend
`start/page.tsx` + `lib/api.ts`), `.env.example` files, `frontend/.gitignore`,
`CLAUDE.md`, `.claude/settings.json`.

**Trap:** the Vercel projects were first created via Git integration (dashboard import),
so a future GitHub push *could* trigger an auto-deploy that **reverts the lot-check feature**
if GitHub is still behind. Push first, then verify production still works.

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

- [ ] **Commit + push** the 9 local changes (see top of file). Highest priority.
- [ ] Migrate `frontend/app/checkout/page.tsx` from its hand-rolled inline-style theme
      (the `V`/`S` objects) onto the Tailwind Shift Log tokens the other pages now use.
      It works and uses the same colors, but it's the last screen not on the shared system.
      Run `/impeccable polish checkout` (Claude Code) when ready.
- [ ] Decide on the deploy story: either run `vercel link` in `backend/` and `frontend/`
      so `npm run deploy` works, or keep deploying via the CLI command below. Also decide
      whether GitHub-push-auto-deploy should be the source of truth (if so, always push
      before relying on it).
- [ ] Optional: reseed script is ad-hoc; consider adding a committed `database/003_*.sql`
      if sample data needs to be restorable repeatably.

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
