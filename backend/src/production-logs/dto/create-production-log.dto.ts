import {
  IsInt, IsString, IsDateString, IsOptional, IsBoolean,
  Min, IsArray, ValidateNested, IsObject, Matches,
} from "class-validator";
import { Type } from "class-transformer";

// HH:MM หรือ HH:MM:SS — ตรงกับ Postgres TIME
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

class DefectEntryDto {
  @IsString() code!: string;
  @IsInt() @Min(1) qty!: number;
}

class StoneChangeDto {
  @IsInt() @Min(0) qtyBeforeChange!: number;
  @IsOptional() @IsString() sizeLeft?: string;
  @IsOptional() @IsString() sizeRight?: string;
  @IsOptional() @Matches(TIME_PATTERN, { message: "downtimeStart ต้องเป็นรูปแบบ HH:MM" })
  downtimeStart?: string;
  @IsOptional() @Matches(TIME_PATTERN, { message: "downtimeEnd ต้องเป็นรูปแบบ HH:MM" })
  downtimeEnd?: string;
}

class TuneRoundDto {
  @IsInt() @Min(1) roundNo!: number;
  @Matches(TIME_PATTERN, { message: "startTime ต้องเป็นรูปแบบ HH:MM" })
  startTime!: string;
  @Matches(TIME_PATTERN, { message: "endTime ต้องเป็นรูปแบบ HH:MM" })
  endTime!: string;
}

export class CreateProductionLogDto {
  @IsInt() machineId!: number;
  @IsInt() knifeId!: number;
  @IsString() lotNo!: string;
  @IsDateString() endedAt!: string;
  @IsInt() @Min(0) totalQty!: number;
  @IsInt() operatorId!: number;
  @IsInt() supervisorId!: number;
  @IsOptional() @IsBoolean() qcApproved?: boolean;
  @IsOptional() @IsString() remark?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DefectEntryDto)
  defects?: DefectEntryDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => StoneChangeDto)
  stoneChange?: StoneChangeDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TuneRoundDto)
  tuneRounds?: TuneRoundDto[];
}