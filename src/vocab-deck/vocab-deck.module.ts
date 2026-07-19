import { Module } from '@nestjs/common';
import { VocabDeckController } from './vocab-deck.controller';
import { VocabDeckLibraryController } from './vocab-deck-library.controller';
import { VocabDeckService } from './vocab-deck.service';
import { PrismaModule } from '../prisma/prisma.module';

// VocabDeckService is intentionally not exported — same reasoning as
// VocabLibraryModule; nothing outside this module consumes it yet.
@Module({
  imports: [PrismaModule],
  controllers: [VocabDeckController, VocabDeckLibraryController],
  providers: [VocabDeckService],
})
export class VocabDeckModule {}
