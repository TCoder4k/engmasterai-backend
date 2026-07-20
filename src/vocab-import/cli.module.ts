import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedModule } from '../shared/shared.module';
import { VocabImportModule } from './vocab-import.module';

// Deliberately minimal: no AuthModule/UserModule/Redis. The CLI only ever
// needs the DB and Cloudinary, and skipping the rest keeps boot fast and
// side-effect-free (approved plan §2).
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, SharedModule, VocabImportModule],
})
export class CliModule {}
