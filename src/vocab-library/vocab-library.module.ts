import { Module } from '@nestjs/common';
import { VocabLibraryController } from './vocab-library.controller';
import { VocabLibraryService } from './vocab-library.service';
import { PrismaModule } from '../prisma/prisma.module';

// VocabLibraryService is now exported (Sprint 04D — Learning Engine):
// reused by LearningService as the library-progress endpoint's visibility
// gate (findOnePublished), the same reuse pattern already established for
// VocabWordService/VocabDeckService.
@Module({
  imports: [PrismaModule],
  controllers: [VocabLibraryController],
  providers: [VocabLibraryService],
  exports: [VocabLibraryService],
})
export class VocabLibraryModule {}
