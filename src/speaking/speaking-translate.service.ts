import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SPEAKING_TRANSLATE_PROVIDER, SpeakingTranslateError } from './speaking-translate.provider';
import type { SpeakingTranslateProvider } from './speaking-translate.provider';

// Speaking Partner — the on-demand subtitle-translation seam's business
// logic. Deliberately thin and stateless: no attempt/exercise lookup, no
// Prisma, no Redis — the DTO already guarantees a non-empty, trimmed,
// length-bounded string by the time it reaches here (see
// TranslateSpeakingTextDto), so this class only owns the one thing a
// controller should not: mapping the provider's failure kinds to an HTTP
// exception, same rule SpeakingAttemptService.generateReply already applies
// to SPEAKING_AI_PROVIDER's own failures.
@Injectable()
export class SpeakingTranslateService {
  constructor(
    @Inject(SPEAKING_TRANSLATE_PROVIDER)
    private readonly translateProvider: SpeakingTranslateProvider,
  ) {}

  async translate(text: string): Promise<{ textVi: string }> {
    try {
      const result = await this.translateProvider.translate({ text });
      return { textVi: result.textVi };
    } catch (caught) {
      if (caught instanceof SpeakingTranslateError) {
        throw new ServiceUnavailableException('Subtitle translation is temporarily unavailable');
      }
      throw caught;
    }
  }
}
