import { Module } from '@nestjs/common';
import { VocabWordController } from './vocab-word.controller';
import { VocabWordService } from './vocab-word.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedModule } from '../shared/shared.module';

// VocabWordService is now exported (Sprint 04 — Learning Engine): this is
// exactly the "leading candidate" reuse this comment used to point at —
// LearningService calls findOneVisibleToUser() directly rather than
// re-deriving the visibility predicate (word on >=1 published deck of a
// published library). VocabDeckModule still reaches word rows through
// Prisma directly (attach/detach/count), unaffected by this export.
@Module({
  imports: [PrismaModule, SharedModule],
  controllers: [VocabWordController],
  providers: [VocabWordService],
  exports: [VocabWordService],
})
export class VocabWordModule {}
