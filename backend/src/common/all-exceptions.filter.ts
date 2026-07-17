import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // HttpException (400/404/409 ที่เราตั้งใจโยน) ปล่อยผ่านตามเดิม
    if (exception instanceof HttpException) {
      return response.status(exception.getStatus()).json(exception.getResponse());
    }

    // อะไรที่เหลือ = ไม่คาดคิด → log เต็ม แต่ตอบสั้น
    this.logger.error("Unhandled exception", exception as any);

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: "Internal Server Error",
      message: "เกิดข้อผิดพลาดในระบบ",
    });
  }
}