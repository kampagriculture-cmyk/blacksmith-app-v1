import { IsInt, IsString, IsOptional, Min } from "class-validator";

// รับเข้าวัสดุ — mirror ของ saveReceipt(formObject) ใน Code.gs
export class CreateReceiptDto {
  @IsString() itemId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsInt() receiverId!: number;

  // เลข PO / supplier — ไม่บังคับ
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() remark?: string;
}
