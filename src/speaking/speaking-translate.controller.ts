import { Body, Controller, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { SpeakingRateLimitGuard } from './rate-limit/speaking-rate-limit.guard';
import { SpeakingRateLimit } from './rate-limit/speaking-rate-limits.decorator';
import { SpeakingTranslateService } from './speaking-translate.service';
import { TranslateSpeakingTextDto } from './dto';

// Speaking Partner — the on-demand subtitle-translation route.
//
// THE BODY NEEDS ITS OWN TRANSFORM-ENABLED PIPE — `main.ts` does not enable
// `transform` globally, so without this the controller would receive the
// RAW, untrimmed `text` (class-validator still validates the trimmed value
// internally either way, but Nest only returns the transformed instance to
// the handler when `transform: true`) — same fix
// SpeakingAttemptController/ShadowingController/ChatController already
// apply to their own body DTOs.
const bodyPipe = new ValidationPipe({ transform: true });

@Controller('speaking')
export class SpeakingTranslateController {
  constructor(private readonly translateService: SpeakingTranslateService) {}

  /**
   * Translate one AI message into Vietnamese, on demand — only called when a
   * student actually opens the subtitle toggle. Stateless: no attempt/
   * exercise scoping, the DTO already guarantees a non-empty, trimmed,
   * length-bounded string.
   */
  @UseGuards(JwtAuthGuard, SpeakingRateLimitGuard)
  @SpeakingRateLimit({ kind: 'translate', max: 60, windowSeconds: 600 })
  @Post('translate')
  async translate(@Body(bodyPipe) dto: TranslateSpeakingTextDto) {
    return this.translateService.translate(dto.text);
  }
}
