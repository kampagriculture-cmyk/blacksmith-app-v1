/**
 * One-off correction, already applied 2026-07-30.
 *
 * migrate-gsheet-history.ts was first committed against a snapshot of the
 * Google Sheet that still misattributed 19 SG-02 rows to ปิยะดา. The source
 * sheet was later corrected to ปรียะดา, but the migration's dedup key
 * (machine_id, lot_no, ended_at) doesn't include operator, so re-running the
 * migration against the corrected CSV silently skipped those 19 rows as
 * "already present" instead of fixing them. This script targets exactly
 * those 19 already-known log ids. Kept as a record of the incident — not
 * meant to be re-run.
 */
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const STALE_LOG_IDS = [44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80];

async function main() {
  const result = await prisma.production_logs.updateMany({
    where: { id: { in: STALE_LOG_IDS }, operator_id: 11 },
    data: { operator_id: 9, updated_at: new Date() },
  });
  console.log("rows updated:", result.count);
  const check = await prisma.production_logs.findMany({
    where: { id: { in: STALE_LOG_IDS } },
    select: { id: true, operator_id: true },
  });
  console.log(check);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
