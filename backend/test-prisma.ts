import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const logs = await prisma.production_logs.findMany({
    where: {
      machines: { code: "SG-01" },
    },
    include: {
      machines: true,
      employees_production_logs_operator_idToemployees: true,
    },
  });

  logs.forEach((log) => {
    console.log(
      log.lot_no,
      "-",
      log.machines.code,
      "-",
      log.employees_production_logs_operator_idToemployees.name
    );
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
