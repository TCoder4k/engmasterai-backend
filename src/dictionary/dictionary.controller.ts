import { Controller, Get, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { DictionaryRateLimitGuard } from './rate-limit/dictionary-rate-limit.guard';
import { DictionaryRateLimit } from './rate-limit/dictionary-rate-limits.decorator';
import { DictionaryService } from './dictionary.service';
import { LookupWordQueryDto } from './dto/lookup-word.dto';

// `main.ts` does not enable `transform` globally — this local pipe is what
// makes LookupWordQueryDto's @Transform (trim/collapse whitespace) actually
// run, same workaround ShadowingController/DictationController use for
// their own query/body DTOs.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  /**
   * Deterministic word lookup. Never fabricates a definition — a genuine
   * miss on every tier is a 404, not a model-invented answer. See
   * dictionary.service.ts for the tier order.
   */
  @UseGuards(JwtAuthGuard, DictionaryRateLimitGuard)
  @DictionaryRateLimit({ kind: 'lookup', max: 40, windowSeconds: 60 })
  @Get('lookup')
  async lookup(@Query(queryPipe) query: LookupWordQueryDto) {
    return this.dictionaryService.lookup(query.q);
  }
}
