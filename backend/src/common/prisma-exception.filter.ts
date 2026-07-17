import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response } from "express";
import { PrismaClientKnownRequestError } from "../../generated/prisma/internal/prismaNamespace";

@Catch(PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // log ของจริงไว้ที่ server เสมอ (มีรายละเอียดครบ)
    this.logger.error(`Prisma ${exception.code}: ${exception.message}`);

    switch (exception.code) {
      // P2003 = Foreign key constraint violated
      case "P2003": {
        const field = (exception.meta?.field_name as string) ?? "";
        return response.status(HttpStatus.BAD_REQUEST).json({
          statusCode: 400,
          error: "Bad Request",
          message: `อ้างอิงข้อมูลที่ไม่มีอยู่จริง (${this.thaiField(field)})`,
        });
      }

      // P2002 = Unique constraint violated
      case "P2002": {
        const target = (exception.meta?.target as string[])?.join(", ") ?? "";
        return response.status(HttpStatus.CONFLICT).json({
          statusCode: 409,
          error: "Conflict",
          message: `ข้อมูลซ้ำ (${target})`,
        });
      }

      // P2025 = Record to update/delete not found
      case "P2025":
        return response.status(HttpStatus.NOT_FOUND).json({
          statusCode: 404,
          error: "Not Found",
          message: "ไม่พบข้อมูลที่ต้องการ",
        });

      // code อื่นที่ยังไม่ได้ map = ระบบมีปัญหาจริง → 500 (ไม่รั่วรายละเอียด)
      default:
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: 500,
          error: "Internal Server Error",
          message: "เกิดข้อผิดพลาดในระบบ",
        });
    }
  }

  private thaiField(field: string): string {
    if (field.includes("machine")) return "machineId — ไม่พบเครื่องนี้";
    if (field.includes("knife")) return "knifeId — ไม่พบเบอร์มีดนี้";
    if (field.includes("operator")) return "operatorId — ไม่พบพนักงานนี้";
    if (field.includes("supervisor")) return "supervisorId — ไม่พบหัวหน้านี้";
    if (field.includes("defect_type")) return "defectTypeCode — ไม่พบชนิดของเสียนี้";
    return field;
  }
}