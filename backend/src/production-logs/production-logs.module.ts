import { Module } from "@nestjs/common";
import { ProductionLogsController } from "./production-logs.controller";
import { ProductionLogsService } from "./production-logs.service";
import { PrismaService } from "../prisma.service";

@Module({
  controllers: [ProductionLogsController],
  providers: [ProductionLogsService, PrismaService],
})
export class ProductionLogsModule {}
