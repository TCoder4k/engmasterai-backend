import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { PrismaService } from '../prisma/prisma.service';
import { getProStatusAndTimeZone } from '../shared/subscription-status.util';
import { UsageQuotaService } from '../usage/usage-quota.service';
import { DictionaryRateLimitGuard } from './rate-limit/dictionary-rate-limit.guard';
import { DictionaryRateLimit } from './rate-limit/dictionary-rate-limits.decorator';
import {
  DEFAULT_SUGGESTION_LIMIT,
  DictionaryService,
} from './dictionary.service';
import { LookupWordQueryDto } from './dto/lookup-word.dto';
import { SuggestWordQueryDto } from './dto/suggest-word.dto';

// `main.ts` does not enable `transform` globally — this local pipe is what
// makes LookupWordQueryDto's @Transform (trim/collapse whitespace) actually
// run, same workaround ShadowingController/DictationController use for
// their own query/body DTOs.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('dictionary')
export class DictionaryController {
  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly usageQuota: UsageQuotaService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Deterministic word lookup. Never fabricates a definition — a genuine
   * miss on every tier is a 404, not a model-invented answer. See
   * dictionary.service.ts for the tier order.
   *
   * 2026-09-16 pricing relaunch — gated by the "aiQuery" usage quota
   * (shared with Engy Chat, see UsageQuotaService). Checked AFTER the cheap
   * Redis rate-limit guard above (so unauthenticated/throttled traffic never
   * reaches a Postgres round-trip) but BEFORE the lookup itself runs, so a
   * rejected request never counts as usage AND never triggers the
   * downstream freedictionaryapi/Gemini calls it exists to bound. Counts
   * every lookup uniformly regardless of which internal tier serves it
   * (VocabWord/Redis-cache hits included) — a deliberate simplification
   * over metering only genuine external calls, since distinguishing tiers
   * here would mean reaching into DictionaryService's internals from the
   * controller; the quota is generous enough (20/month Free) that this
   * costs a normal learner nothing in practice.
   */
  @UseGuards(JwtAuthGuard, DictionaryRateLimitGuard)
  @DictionaryRateLimit({ kind: 'lookup', max: 40, windowSeconds: 60 })
  @Get('lookup')
  async lookup(
    @Req() req: AuthenticatedRequest,
    @Query(queryPipe) query: LookupWordQueryDto,
  ) {
    const { isPro, timeZone } = await getProStatusAndTimeZone(
      this.prisma,
      req.user.userId,
    );
    await this.usageQuota.checkAndIncrement(
      req.user.userId,
      'aiQuery',
      isPro,
      timeZone,
    );
    return this.dictionaryService.lookup(query.q);
  }

  /**
   * Prefix autocomplete — VocabWord only (see DictionaryService.suggest).
   * A separate, more generous namespace than 'lookup': this fires on
   * debounced keystrokes against local data only, never an external/AI call.
   */
  @UseGuards(JwtAuthGuard, DictionaryRateLimitGuard)
  @DictionaryRateLimit({ kind: 'suggest', max: 100, windowSeconds: 60 })
  @Get('suggestions')
  async suggestions(@Query(queryPipe) query: SuggestWordQueryDto) {
    return this.dictionaryService.suggest(
      query.q,
      query.limit ?? DEFAULT_SUGGESTION_LIMIT,
    );
  }
}
