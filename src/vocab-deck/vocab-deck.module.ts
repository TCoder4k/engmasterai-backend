import { Module } from '@nestjs/common';
import { VocabDeckController } from './vocab-deck.controller';
import { VocabDeckLibraryController } from './vocab-deck-library.controller';
import { VocabDeckWordController } from './vocab-deck-word.controller';
import { VocabDeckService } from './vocab-deck.service';
import { PrismaModule } from '../prisma/prisma.module';

// VocabDeckService is now exported (Sprint 04D — Learning Engine): reused
// by LearningService as the deck-progress endpoint's visibility gate
// (findOnePublished), the same reuse pattern already established for
// VocabWordService in Sprint 04C. Word-bank access (existence checks,
// attach/detach) still goes through Prisma directly rather than depending
// on VocabWordService — that part of the original reasoning is unaffected.
@Module({
  imports: [PrismaModule],
  controllers: [
    VocabDeckController,
    VocabDeckLibraryController,
    VocabDeckWordController,
  ],
  providers: [VocabDeckService],
  exports: [VocabDeckService],
})
export class VocabDeckModule {}
