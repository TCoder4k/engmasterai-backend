import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { SpeakingRateLimitGuard } from './rate-limit/speaking-rate-limit.guard';
import { SpeakingRateLimit } from './rate-limit/speaking-rate-limits.decorator';
import { SpeakingScenarioService } from './speaking-scenario.service';

// Speaking Partner — the student-facing catalog reads.
//
// BOTH ROUTES ARE READ-ONLY. Nothing here writes a row, stamps a timestamp
// or mints a session — starting a conversation is an explicit
// POST .../attempts (speaking-attempt.controller.ts).
//
// AUTHENTICATED, not public — reached only from inside the student app,
// same reasoning as the Listening catalog.
//
// Anti-probing: a missing scenario id and a draft scenario produce the SAME
// 404 (speaking-visibility.ts's shape, applied inline in the service). Do
// not add a distinguishing message here.
@Controller('speaking')
export class SpeakingCatalogController {
  constructor(private readonly scenarioService: SpeakingScenarioService) {}

  @UseGuards(JwtAuthGuard, SpeakingRateLimitGuard)
  @SpeakingRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('scenarios')
  async findScenarios() {
    return this.scenarioService.findPublishedCatalog();
  }

  @UseGuards(JwtAuthGuard, SpeakingRateLimitGuard)
  @SpeakingRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('scenarios/:id')
  async findScenario(@Param('id', ParseUUIDPipe) id: string) {
    return this.scenarioService.findPublishedDetail(id);
  }
}
