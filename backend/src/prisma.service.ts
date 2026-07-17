import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// @Injectable() บอก NestJS ว่าคลาสนี้ "ฉีดเข้า" (inject) ที่อื่นได้
// ทำให้ทุก Service ในระบบใช้ PrismaClient ตัวเดียวกันร่วมกัน
// ไม่ต้อง new PrismaClient() ซ้ำๆ ในทุกไฟล์แบบที่ทำใน test-prisma.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
