import { IsString, IsOptional, MaxLength } from "class-validator";

export class DeleteProductionLogDto {
  @IsString() @MaxLength(100)
  deletedBy!: string; // required — เหมือน editedBy ฝั่ง update ไม่มี auth เลยรับจาก client ตรงๆ

  @IsOptional() @IsString() @MaxLength(500)
  deleteReason?: string;
}
