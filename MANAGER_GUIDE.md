# Manager's Guide — Blacksmith Production System

> For whoever runs day-to-day admin of this system (adding people, machines, knife
> types, defect codes, and consumable materials). No coding background assumed — every
> operation below is a database change only, no code editing or redeploying required.
>
> Companion docs: `CLAUDE.md` (technical architecture), `CONCURRENCY.md` (locking
> internals), `HANDOFF.md` (live URLs, infra, deploy history).

---

## 1. The most important thing to understand first

**The database is the only source of truth.** The *Start* and *Checkout* screens ask
the backend "who are the operators / which machines / which knives / which defect
codes exist?" every time they load (`GET /production-logs/config`), the same way the
*Inventory* screen already asked for materials (`GET /inventory/items`). So adding a
row to the database is the entire operation — the website picks it up automatically,
no code change, no redeploy, no waiting.

*(This wasn't always true — until 2026-07-30 those first two screens read from lists
hardcoded into the frontend code that had to be hand-edited and redeployed every time
someone was added. That's gone now. If you're reading an old note/screenshot that
mentions editing `frontend/lib/employees.ts` or a `MACHINES`/`KNIVES` const, it's
stale — ignore it.)*

**One real limitation to know about:** there's no "hide without deleting" flag for
`employees`, `machines`, `knives`, or `defect_types` the way `item_master` has
`active`. Every employee ever inserted — including someone who's since left — shows up
in the operator/supervisor dropdowns forever, because the dropdown is just "everyone in
the table," unfiltered. There's no clean way today to keep someone's historical work
orders intact while hiding them from new selections. If this becomes a real problem,
that's a small schema change (an `active` boolean, same pattern as `item_master`) —
ask a developer for it rather than trying to work around it with DB tricks.

---

## 2. What you need before you start

**Database access** — that's it. Log in to the [Neon console](https://console.neon.tech),
open this project, and use the **SQL Editor** tab. That's the easiest way to run the
`INSERT`/`UPDATE` statements below without installing anything. (A desktop tool like
DBeaver also works if someone already set that up for you — it needs the connection
string from `backend/.env`, which is not committed to git and should only be shared
through a secure channel.)

---

## 3. Add a new Operator, Supervisor, or QC person

```sql
INSERT INTO employees (name, role)
VALUES ('ชื่อพนักงานใหม่', 'operator');   -- role must be exactly: operator / supervisor / qc
```

That's it — next time anyone opens *Start* or *Checkout*, the new person is in the
dropdown.

To **stop** someone from appearing in the dropdown (e.g. they've left) without losing
their history: there's currently no flag for this (see the limitation in Section 1).
Leaving their row as-is (still selectable) is the only option today short of a schema
change.

---

## 4. Add a new Machine

```sql
INSERT INTO machines (code) VALUES ('SG-03');
```

Optionally, if you want the new machine to have a default owner (the `machine_owners`
table — currently informational only, nothing in the app reads it yet):

```sql
INSERT INTO machine_owners (machine_id, operator_id)
VALUES ((SELECT id FROM machines WHERE code = 'SG-03'), (SELECT id FROM employees WHERE name = 'ชื่อพนักงาน'));
```

---

## 5. Add a new Knife type

```sql
INSERT INTO knives (code) VALUES ('999');
```

---

## 6. Add a new Defect Type

Defect codes are the checkboxes/quantities on the Checkout screen (currently H01–H15).
`defect_types.code` is a short text code you choose yourself (not auto-generated) —
just pick the next unused one:

```sql
INSERT INTO defect_types (code, name_th, display_order)
VALUES ('H16', 'ชื่อของเสียใหม่', 16);
```

`display_order` controls where it appears in the list on the Checkout screen —
usually just the next number after the current highest.

---

## 7. Add / manage a Material (Inventory item)

Same pattern as everything else now — the *Inventory* screen has always read this
table live.

**Add a new material:**

```sql
INSERT INTO item_master (id, name, unit, reorder_point, active)
VALUES ('STONE-450', 'หินลับขนาด 450', 'ก้อน', 10, true);
```

- `id` is a short code you choose (e.g. `STONE-450`), used internally — keep it
  short and consistent with existing ones (`STONE-380`, `COOLANT`, `SANDPAPER`).
- `reorder_point` drives the stock-status color on the Inventory screen: balance ≤
  `reorder_point` → "สั่งซื้อด่วน" (critical, shown first); balance ≤ `reorder_point
  × 1.5` → "ใกล้หมด" (warning); above that → "ปกติ" (normal).

**Discontinue a material** (don't delete it — it has withdrawal/receipt history tied
to it via foreign keys, and deleting would break that history or simply be rejected
by the database):

```sql
UPDATE item_master SET active = false WHERE id = 'STONE-450';
```

Setting `active = false` removes it from the Inventory dropdowns immediately (the
API only returns `active = true` items) without touching past records. This is the
`active`-flag pattern mentioned in Section 1 that the other reference tables don't
have yet.

**Change a reorder point** (e.g. usage picked up and you want an earlier warning):

```sql
UPDATE item_master SET reorder_point = 15 WHERE id = 'STONE-380';
```

Takes effect immediately — the balance/status shown on the Inventory screen is
computed live.

---

## 8. Day-to-day reference

**Dashboard** (`/dashboard`) shows every `in_progress` work order live — which
machine, which operator, since when. Nothing to manage here, it's read-only.

**Common Thai status/error text you'll see:**

| Thai | Meaning |
|---|---|
| ปกติ | Normal stock level |
| ใกล้หมด | Low stock warning (≤ 1.5× reorder point) |
| สั่งซื้อด่วน | Critical — at or below reorder point, order now |
| เครื่องนี้มีงานค้างอยู่ | That machine already has an open work order — must be checked out before starting a new one |
| ล็อตนี้ ... เสร็จงานไปแล้ว | That lot number was already completed — can't reuse it |
| log id ... ปิดงานไปแล้ว | That work order was already checked out — can't check out twice |

**If a person/machine/knife/defect dropdown looks wrong**, it's a DB data issue now,
not a sync issue — check the table directly (`SELECT * FROM employees;` etc.) rather
than looking for a stale frontend file (there isn't one anymore).

---

## 9. ประวัติบันทึกการผลิต — viewing and correcting past work orders

The **ประวัติบันทึกการผลิต** screen (`/records`, linked from the home page) lists every
completed work order, newest first, one row per lot. Filter by machine, operator, or
date range at the top; the list pages 20 at a time.

**This screen is for looking back and fixing mistakes — not for recording work.** Normal
recording still happens automatically when an operator checks out a job.

### Correcting a log

If a work order was checked out with a mistake (e.g. the total quantity was miscounted),
click its row to open the edit box. You can correct:

- **จำนวนทั้งหมด** (total quantity)
- **พนักงาน** (operator)
- **หัวหน้างาน** (supervisor)

Machine, knife, lot number, and dates are shown but locked — if those are wrong, it's the
*wrong record*, not a wrong value, so it needs a developer rather than an edit.

Two fields are required before the save button turns on:

- **แก้ไขโดย** — who is making this correction (pick your own name)
- **เหตุผล** — why, in plain words (e.g. "นับยอดผิดตอน checkout")

**Nothing is ever overwritten or deleted.** Every correction keeps a full snapshot of the
old values along with who changed it and why. A row that's been corrected shows an amber
**"แก้ไขแล้ว ×N"** badge in the list so it's obvious at a glance, and the edit box shows
the current version number.

The total quantity can't be set below the defect count already recorded for that lot —
the box will block it and tell you why.

### Reading the history directly

The screen doesn't show the full past-values timeline yet (that's a later phase). To read
it now, either use `GET /production-logs/<id>/history`, or query the database:

```sql
SELECT * FROM production_log_history WHERE production_log_id = <id> ORDER BY version DESC;
```

`production_logs.version` tells you how many times a log has been corrected (starts at 1,
+1 per edit).

---

## 10. Safety notes

- Never `DELETE` a row from `employees`, `machines`, `knives`, or `item_master` that
  has any history attached (foreign keys will usually stop you anyway) — for
  `item_master` use the `active` flag instead (Section 7); for the others there's no
  flag yet (Section 1), so leaving the row in place is currently the only safe option.
- Don't hand-edit `id` values — they're auto-generated (`SERIAL`) for everything
  except `defect_types.code` and `item_master.id`, which you choose deliberately as
  short text codes.
- If you're ever about to run a `DELETE` or `UPDATE ... WHERE` without a specific id
  (i.e. it would touch more than one row), stop and get a second pair of eyes on it
  first — there's no undo button in the SQL Editor.
- For anything structural (adding a new *column*, not just new *rows* — e.g. the
  `active` flag idea in Section 1), that's a schema change, not a data change — hand
  that to a developer and see the "Database" section of `CLAUDE.md`.
