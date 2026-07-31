import {
  Controller, Post, Get, Patch, Delete, Body, Query, Param, ParseIntPipe,
} from "@nestjs/common";
import { ProductionLogsService } from "./production-logs.service";
import { CreateProductionLogDto } from "./dto/create-production-log.dto";
import { StartWorkOrderDto } from "./dto/start-work-order.dto";
import { CheckoutWorkOrderDto } from "./dto/checkout-work-order.dto";
import { UpdateProductionLogDto } from "./dto/update-production-log.dto";
import { DeleteProductionLogDto } from "./dto/delete-production-log.dto";
import { RecordsQueryDto } from "./dto/records-query.dto";

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

  @Get("lot-check")
  checkLot(@Query("lotNo") lotNo: string) {
    return this.service.checkLot(lotNo);
  }

  @Get("config")
  getConfig() {
    return this.service.getConfig();
  }

  @Get("analytics")
  getAnalyticsData() {
    return this.service.getAnalyticsData();
  }

  @Get("machine-owners")
  getMachineOwners() {
    return this.service.getMachineOwners();
  }

  @Get("records")
  getRecords(@Query() query: RecordsQueryDto) {
    return this.service.getRecords(query);
  }

  @Post()
  create(@Body() dto: CreateProductionLogDto) {
    return this.service.create(dto);
  }

  @Get()
  findByMachine(@Query("machine") machine: string) {
    return this.service.findByMachine(machine);
  }

  // ⚠ :id routes ต้องอยู่ท้ายสุดเสมอ — หลัง static routes ทั้งหมดด้านบน
  // (start, in-progress, lot-check, config, analytics, machine-owners)
  @Patch(":id")
  updateLog(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateProductionLogDto,
  ) {
    return this.service.updateLog(id, dto);
  }

  @Get(":id/history")
  getLogHistory(@Param("id", ParseIntPipe) id: number) {
    return this.service.getLogHistory(id);
  }

  @Delete(":id")
  deleteLog(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DeleteProductionLogDto,
  ) {
    return this.service.deleteLog(id, dto);
  }
}