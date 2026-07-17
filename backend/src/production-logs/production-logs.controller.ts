import {
  Controller, Post, Get, Patch, Body, Query, Param, ParseIntPipe,
} from "@nestjs/common";
import { ProductionLogsService } from "./production-logs.service";
import { CreateProductionLogDto } from "./dto/create-production-log.dto";
import { StartWorkOrderDto } from "./dto/start-work-order.dto";
import { CheckoutWorkOrderDto } from "./dto/checkout-work-order.dto";

@Controller("production-logs")
export class ProductionLogsController {
  constructor(private service: ProductionLogsService) {}

  // ⚠ ต้องอยู่ก่อน @Post(":id/checkout") ไม่งั้น route ชนกัน (ดู Troubleshooting)
  @Post("start")
  start(@Body() dto: StartWorkOrderDto) {
    return this.service.startWorkOrder(dto);
  }

  @Patch(":id/checkout")
  checkout(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CheckoutWorkOrderDto,
  ) {
    return this.service.checkoutWorkOrder(id, dto);
  }

  @Get("in-progress")
  findInProgress() {
    return this.service.findInProgress();
  }

  @Post()
  create(@Body() dto: CreateProductionLogDto) {
    return this.service.create(dto);
  }

  @Get()
  findByMachine(@Query("machine") machine: string) {
    return this.service.findByMachine(machine);
  }
}