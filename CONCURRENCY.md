# Concurrency & Locking — Blacksmith Production System

> Companion to `CLAUDE.md`. That file summarizes this in a paragraph; this file is the
> full walkthrough — why each lock exists, what breaks without it, and how to prove it
> works with the `test-concurrent*.js` scripts.

---

## Why this matters

Two shop-floor actions race in practice, not just in theory: two operators (or one
operator double-tapping a slow UI) can hit **start work order** on the same machine at
the same instant, or hit **checkout** on the same log twice. Without explicit locking,
Postgres's default read-committed isolation lets both requests read "no conflict yet"
before either has written anything, and both proceed — a machine ends up with two
open logs, or a log gets checked out twice with different quantities.

Two endpoints are concurrency-sensitive, and each is protected by a *different*
mechanism because the failure shape is different:

| Endpoint | Race | Guard |
|---|---|---|
| `POST /production-logs/start` | Two inserts for the same machine | Postgres **advisory lock** + DB **partial unique index** (defense in depth) |
| `PATCH /production-logs/:id/checkout` | Two updates on the same row | **Row lock** (`SELECT ... FOR UPDATE`) |

Both live in `backend/src/production-logs/production-logs.service.ts`.

---

## `startWorkOrder` — advisory lock + unique index

```ts
await tx.$executeRaw`
  SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE_MACHINE}::int, ${dto.machineId}::int)`;
```

- `pg_advisory_xact_lock(42, machineId)` takes a session-scoped lock keyed on
  `(namespace=42, machineId)`, held for the lifetime of the enclosing `$transaction`.
  Namespace `42` just keeps this lock space from colliding with any other advisory
  locks the app might take later.
- It's acquired **before** the "is this machine already in progress?" read. That
  ordering is the whole point: concurrent requests for the same machine queue up on
  the lock one at a time, so each one's read-then-insert sees a consistent picture —
  no two requests can both read "free" before either has inserted.
- Different machine IDs don't block each other — the lock is per-machine, not global.

**Backstop:** `database/001_init_schema.sql` also has

```sql
CREATE UNIQUE INDEX one_in_progress_per_machine ON production_logs (machine_id)
  WHERE status = 'in_progress';
```

This is a DB-level constraint, not just app logic. If the advisory lock were ever
removed, skipped (e.g. a future code path that inserts outside `startWorkOrder`), or
simply buggy, this index still makes a second concurrent insert fail with a Postgres
unique-violation — which `PrismaExceptionFilter` maps to a 409. The lock makes the
*common case* fast and gives a clean Thai error message; the index makes the
*failure case* impossible to slip past even in code paths that forget the lock.

Same transaction also re-checks `lot_no` isn't already `completed` or `in_progress`
elsewhere, so a lot can't be double-started even across different machines.

### The "negative control" comment

```ts
// ★ PHASE 3 NEGATIVE CONTROL — ปิดชั่วคราว อย่าลืมเปิดคืน!
await tx.$executeRaw`SELECT pg_advisory_xact_lock(...)`;
```

Translation: *"temporarily disabled — don't forget to turn it back on!"* This is a
leftover marker from proving the test actually detects a broken lock: comment out the
`pg_advisory_xact_lock` call, re-run `test-concurrent.js`, and confirm it now reports
**FAIL** (more than one `201`) instead of blindly passing. That's the "negative
control" — it validates the test itself, not just the feature. As written today the
lock call is active; if you ever comment it out to re-run that control, **restore it
before committing**.

---

## `checkoutWorkOrder` — row lock

```ts
const rows = await tx.$queryRaw`
  SELECT id, status, machine_id FROM production_logs WHERE id = ${id} FOR UPDATE`;
```

- `FOR UPDATE` takes a row-level lock on that specific `production_logs` row for the
  rest of the transaction. A second concurrent checkout on the same `id` blocks on the
  `SELECT` itself until the first transaction commits or rolls back.
- The status check (`current.status !== "in_progress"` → 409) happens *after* the lock
  is held, so the second request always sees the first request's committed `status =
  'completed'` and correctly rejects the double-checkout — it can't read stale
  "in_progress" state.
- No partial unique index backs this one up (unlike `start`), because "checked out
  twice" isn't a shape a unique index can express — the row lock is the only guard.
  Keep it in place if this method is refactored.

---

## Verifying the locks: `test-concurrent*.js`

Both scripts live in `backend/` and fire real HTTP requests at a running
`nest start --watch` (port 3001) — they're not unit tests, they're black-box proof
the locking holds under actual parallel load. Requires no test framework: plain Node
+ `fetch`, run with `node test-concurrent.js`.

**`test-concurrent.js`** — fires `N = 5` concurrent `POST /production-logs/start` at
the same `machineId`. Expects exactly one `201` and `N - 1` `409`s. Includes a
preflight check that the target machine has no existing in-progress log, so a stale
row from a previous failed run doesn't make the result unreadable.

**`test-concurrent-checkout.js`** — same idea, aimed at
`PATCH /production-logs/:id/checkout` on the same log id. Expects exactly one success
and the rest `409 Conflict`.

To run either:

```bash
cd backend
npx nest start --watch      # terminal 1
node test-concurrent.js     # terminal 2 (edit MACHINE_ID/etc. at the top first)
```

If a run reports `ok > 1` (more than one `201`), that's a real lock failure, not
flaky infra — stop and investigate before touching this file further.

---

## Rules for future changes here

- Never remove or reorder the lock-then-check pattern in either method: acquire the
  lock/row-lock **first**, read state **second**, write **third**. Reordering
  reopens the exact race these guards exist to close.
- If you add a new mutation on `production_logs` outside these two methods, decide
  explicitly whether it needs the same lock — don't assume the unique index alone is
  enough unless the new path is genuinely insert-only like `start` is.
- If you touch `startWorkOrder` or `checkoutWorkOrder`, re-run both
  `test-concurrent*.js` scripts before considering the change done.
