import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    //Khởi tạo constructor Prisma Service
    super(); //tạo instance PrismaClient bên trong PrismaService
  }

  async onModuleInit() {
    await this.$connect(); //Kết nối database
    console.log('✅ Prisma connected');
  }

  // Without this, app.close() never releases the underlying Prisma
  // connection/engine — every e2e file compiles its own AppModule, so a full
  // run leaves one leaked connection per file, keeping the process alive
  // after all tests have genuinely finished (see README "CI contract").
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
