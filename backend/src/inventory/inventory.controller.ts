import { Controller, Get, Post, Body } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { CreateWithdrawalDto } from "./dto/create-withdrawal.dto";
import { CreateReceiptDto } from "./dto/create-receipt.dto";

@Controller("inventory")
export class InventoryController {
  constructor(private service: InventoryService) {}

  @Get("items")
  getItems() {
    return this.service.getItems();
  }

  @Get("config")
  getConfig() {
    return this.service.getConfig();
  }

  @Get("stock")
  getStock() {
    return this.service.getStock();
  }

  @Post("withdrawals")
  createWithdrawal(@Body() dto: CreateWithdrawalDto) {
    return this.service.createWithdrawal(dto);
  }

  @Post("receipts")
  createReceipt(@Body() dto: CreateReceiptDto) {
    return this.service.createReceipt(dto);
  }
}
