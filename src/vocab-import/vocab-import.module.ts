import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedModule } from '../shared/shared.module';
import { DatasetAnalyzerService } from './analyzer/dataset-analyzer.service';
import { ImportValidatorService } from './validation/import-validator.service';
import { MapperRegistry } from './mappers/mapper.registry';
import { MediaResolverService } from './media/media-resolver.service';
import { MediaUploaderService } from './media/media-uploader.service';
import { ImportEngineService } from './engine/import-engine.service';
import { DeckBuilderService } from './engine/deck-builder.service';

const PROVIDERS = [
  DatasetAnalyzerService,
  ImportValidatorService,
  MapperRegistry,
  MediaResolverService,
  MediaUploaderService,
  ImportEngineService,
  DeckBuilderService,
];

@Module({
  imports: [PrismaModule, SharedModule],
  providers: PROVIDERS,
  exports: PROVIDERS,
})
export class VocabImportModule {}
