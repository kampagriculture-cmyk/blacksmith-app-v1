import { Module } from "@nestjs/common";
import { ProductionLogsModule } from "./production-logs/production-logs.module";

@Module({
  imports: [ProductionLogsModule],
})
export class AppModule {}
