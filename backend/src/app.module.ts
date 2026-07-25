import { Module } from "@nestjs/common";
import { ProductionLogsModule } from "./production-logs/production-logs.module";
import { InventoryModule } from "./inventory/inventory.module";

@Module({
  imports: [ProductionLogsModule, InventoryModule],
})
export class AppModule {}
