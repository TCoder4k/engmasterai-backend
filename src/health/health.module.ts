import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  // PrismaModule isn't @Global(), so it must be imported explicitly here.
  // SharedRedisModule (used via @InjectRedis()) is @Global() — no import
  // needed for it.
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
