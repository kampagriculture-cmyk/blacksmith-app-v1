import { IsInt, IsString, IsOptional, Min } from "class-validator";

// เบิกวัสดุ — mirror ของ saveWithdrawal(formObject) ใน Code.gs
export class CreateWithdrawalDto {
  @IsString() itemId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsInt() withdrawerId!: number;

  // เครื่องปลายทาง — ไม่บังคับ (FK ไป machines)
  @IsOptional() @IsInt() machineId?: number;

  // สภาพวัสดุเก่าที่คืน (เปลี่ยนพอดีขีด / ก่อนถึงขีด / เลยขีดวงใน)
  @IsOptional() @IsString() condition?: string;
  // เหตุผล — โผล่เฉพาะกรณี "เปลี่ยนก่อนถึงขีด"
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() remark?: string;
}
