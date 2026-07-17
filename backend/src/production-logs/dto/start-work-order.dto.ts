import { IsInt, IsString, IsOptional, IsDateString } from "class-validator";

export class StartWorkOrderDto {
  @IsInt() machineId!: number;
  @IsInt() knifeId!: number;
  @IsString() lotNo!: string;
  @IsInt() operatorId!: number;

  // ไม่ส่งมา = ใช้เวลา server ตอนนี้ (ปกติหน้างานกดตอนเริ่มจริง)
  @IsOptional() @IsDateString() startedAt?: string;
}