import { Module } from '@nestjs/common';
import { VocabDeckController } from './vocab-deck.controller';
import { VocabDeckLibraryController } from './vocab-deck-library.controller';
import { VocabDeckWordController } from './vocab-deck-word.controller';
import { VocabDeckService } from './vocab-deck.service';
import { PrismaModule } from '../prisma/prisma.module';

// VocabDeckService is intentionally not exported — same reasoning as
// VocabLibraryModule; nothing outside this module consumes it yet. Word-bank
// access (existence checks, attach/detach) goes through Prisma directly
// rather than depending on VocabWordService — neither module needs to
// export anything to the other.
@Module({
  imports: [PrismaModule],
  controllers: [VocabDeckController, VocabDeckLibraryController, VocabDeckWordController],
  providers: [VocabDeckService],
})
export class VocabDeckModule {}
