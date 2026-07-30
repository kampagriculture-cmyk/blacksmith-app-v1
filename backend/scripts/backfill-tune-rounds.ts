/**
 * One-time backfill: 148 migrated production_logs rows have "จูน: HH:MM-HH:MM (N นาที)"
 * folded into their remark field (per the original migration decision — see
 * migrate-gsheet-history.ts comments). Of those, only 10 have a real non-empty time
 * range (the other 138 are literal "จูน:  (0 นาที)" — genuinely nothing to backfill).
 * This inserts a single tune_rounds row (round_no=1) for each of those 10.
 *
 * Idempotent: skips any production_log that already has a tune_rounds row.
 *
 * Usage (from backend/):
 *   npx tsx scripts/backfill-tune-rounds.ts            # dry run
 *   npx tsx scripts/backfill-tune-rounds.ts --commit    # write
 */
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const COMMIT = process.argv.includes("--commit");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TUNE_RE = /จูน:\s*(\d{2}:\d{2})-(\d{2}:\d{2})\s*\((\d+)\s*นาที\)/;

function timeStringToDate(time: string): Date {
  return new Date(`1970-01-01T${time}:00Z`);
}

function minutesBetween(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d < 0) d += 1440;
  return d;
}

async function main() {
  console.log(COMMIT ? "=== COMMIT MODE ===" : "=== DRY RUN (pass --commit to write) ===");

  const rows = await prisma.production_logs.findMany({
    where: { remark: { contains: "จูน:" } },
    select: { id: true, lot_no: true, remark: true },
    orderBy: { id: "asc" },
  });

  let parsed = 0, skippedEmpty = 0, skippedExisting = 0, mismatch = 0;

  for (const row of rows) {
    const m = TUNE_RE.exec(row.remark ?? "");
    if (!m) { skippedEmpty++; continue; }
    const [, start, end, statedMinutesStr] = m;
    const computedMinutes = minutesBetween(start, end);
    const statedMinutes = parseInt(statedMinutesStr, 10);
    if (computedMinutes !== statedMinutes) {
      mismatch++;
      console.log(`!!! lot=${row.lot_no} id=${row.id} — stated ${statedMinutes}min but ${start}-${end} computes to ${computedMinutes}min — SKIPPING, needs a human look`);
      continue;
    }

    const existing = await prisma.tune_rounds.findFirst({ where: { production_log_id: row.id } });
    if (existing) { skippedExisting++; continue; }

    parsed++;
    console.log(`${COMMIT ? "inserting" : "would insert"} tune_rounds for lot=${row.lot_no} id=${row.id}: ${start}-${end} (${computedMinutes}min)`);
    if (COMMIT) {
      await prisma.tune_rounds.create({
        data: {
          production_log_id: row.id,
          round_no: 1,
          start_time: timeStringToDate(start),
          end_time: timeStringToDate(end),
        },
      });
    }
  }

  console.log(`\nchecked ${rows.length} rows with "จูน:" in remark`);
  console.log(`${COMMIT ? "inserted" : "would insert"}=${parsed} skipped(empty/no-range)=${skippedEmpty} skipped(already has tune_rounds)=${skippedExisting} mismatch(needs review)=${mismatch}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
