import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit
{
  constructor() { //Khởi tạo constructor Prisma Service
    super(); //tạo instance PrismaClient bên trong PrismaService
  }

  async onModuleInit() {
    await this.$connect(); //Kết nối database
    console.log('✅ Prisma connected');
  }
}
