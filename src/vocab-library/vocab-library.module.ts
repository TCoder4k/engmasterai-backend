import { Module } from '@nestjs/common';
import { VocabLibraryController } from './vocab-library.controller';
import { VocabLibraryService } from './vocab-library.service';
import { PrismaModule } from '../prisma/prisma.module';

// VocabLibraryService is intentionally not exported — nothing outside this
// module consumes it yet. Add the export the moment a real caller needs it.
@Module({
  imports: [PrismaModule],
  controllers: [VocabLibraryController],
  providers: [VocabLibraryService],
})
export class VocabLibraryModule {}
