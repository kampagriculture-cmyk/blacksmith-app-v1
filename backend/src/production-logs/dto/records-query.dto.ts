import { IsOptional, IsInt, Min, IsDateString } from "class-validator";
import { Type } from "class-transformer";

export class RecordsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number = 20;

  @IsOptional() @Type(() => Number) @IsInt()
  machineId?: number;

  @IsOptional() @Type(() => Number) @IsInt()
  operatorId?: number;

  @IsOptional() @IsDateString()
  dateFrom?: string;

  @IsOptional() @IsDateString()
  dateTo?: string;
}
