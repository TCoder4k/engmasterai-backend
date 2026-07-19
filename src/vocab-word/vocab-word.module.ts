import { Module } from '@nestjs/common';
import { VocabWordController } from './vocab-word.controller';
import { VocabWordService } from './vocab-word.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedModule } from '../shared/shared.module';

// VocabWordService is intentionally not exported — same no-consumer
// discipline as VocabLibraryModule/VocabDeckModule. The vocab-deck module
// reaches word rows through Prisma directly (attach/detach/count), not
// through this service, so neither module needs to export anything to the
// other. Add the export the moment a real external caller needs it (the
// leading candidate being Phase 3's review-submission validation reusing
// the visibility seam — see the approved plan's Phase 2→3 handoff #1).
@Module({
  imports: [PrismaModule, SharedModule],
  controllers: [VocabWordController],
  providers: [VocabWordService],
})
export class VocabWordModule {}
