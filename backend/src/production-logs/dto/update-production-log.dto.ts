import {
  IsOptional, IsInt, Min, IsString, IsIn, IsBoolean, IsDateString, MaxLength,
  IsArray, ValidateNested, IsObject, Matches, ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";

const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

class StoneChangeEditDto {
  @IsInt() @Min(0) qtyBeforeChange!: number;
  @IsOptional() @IsString() sizeLeft?: string;
  @IsOptional() @IsString() sizeRight?: string;
  @IsOptional() @Matches(TIME_PATTERN, { message: "downtimeStart ต้องเป็นรูปแบบ HH:MM" })
  downtimeStart?: string;
  @IsOptional() @Matches(TIME_PATTERN, { message: "downtimeEnd ต้องเป็นรูปแบบ HH:MM" })
  downtimeEnd?: string;
}

class TuneRoundEditDto {
  @IsInt() @Min(1) roundNo!: number;
  @Matches(TIME_PATTERN, { message: "startTime ต้องเป็นรูปแบบ HH:MM" })
  startTime!: string;
  @Matches(TIME_PATTERN, { message: "endTime ต้องเป็นรูปแบบ HH:MM" })
  endTime!: string;
}

export class UpdateProductionLogDto {
  // === ทุก field ของ production_logs แก้ได้หมด ตามที่ตกลงกัน — ต่างจากตอนแรกที่
  // ล็อค machine/knife/lot/เวลา/status ไว้ อ้างว่า "ผิดคือ record ผิดตัว" แต่ในทางปฏิบัติ
  // ต้องแก้ record ผิดตัวได้ด้วย (สแกน/เลือกเครื่องผิดตอนเปิดงาน ก็ต้องแก้ตรงนี้ได้) ===
  @IsOptional() @IsInt()
  machineId?: number;

  @IsOptional() @IsInt()
  knifeId?: number;

  @IsOptional() @IsString() @MaxLength(50)
  lotNo?: string;

  @IsOptional() @IsIn(["in_progress", "completed"])
  status?: string;

  @IsOptional() @IsDateString()
  startedAt?: string;

  @IsOptional() @IsDateString()
  endedAt?: string;

  @IsOptional() @IsInt() @Min(0)
  totalQty?: number;

  @IsOptional() @IsInt()
  operatorId?: number;

  @IsOptional() @IsInt()
  supervisorId?: number;

  @IsOptional() @IsBoolean()
  qcApproved?: boolean;

  @IsOptional() @IsString()
  remark?: string;

  // === child records — เพิ่มเข้ามาเพราะช่างมักลืมกรอกเวลาจูนตอน checkout จริง แล้ว
  // ต้องมาเพิ่ม/แก้ทีหลัง ===
  //
  // stoneChange: undefined = ไม่แตะ, null = ลบการเปลี่ยนหินออก (ถ้ามี), object = upsert
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject() @ValidateNested()
  @Type(() => StoneChangeEditDto)
  stoneChange?: StoneChangeEditDto | null;

  // tuneRounds: undefined = ไม่แตะ, [] = ลบรอบจูนทั้งหมด, [...] = แทนที่ทั้งชุด (ไม่ merge ทีละรอบ)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TuneRoundEditDto)
  tuneRounds?: TuneRoundEditDto[];

  // === audit fields ===
  @IsString() @MaxLength(100)
  editedBy!: string; // required — ต้องรู้ว่าใครแก้ ระบบยังไม่มี auth เลยรับมาจาก client ตรงๆ

  @IsOptional() @IsString() @MaxLength(500)
  editReason?: string;
}
