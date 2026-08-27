import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { VocabPersonalRateLimitGuard } from './rate-limit/vocab-personal-rate-limit.guard';
import { VocabPersonalRateLimit } from './rate-limit/vocab-personal-rate-limits.decorator';
import { VocabPersonalService } from './vocab-personal.service';
import { CreatePersonalVocabWordDto } from './dto/create-personal-vocab-word.dto';
import { UpdatePersonalVocabWordDto } from './dto/update-personal-vocab-word.dto';
import { BulkCreatePersonalVocabWordsDto } from './dto/bulk-create-personal-vocab-words.dto';
import { QueryPersonalVocabWordsDto } from './dto/query-personal-vocab-words.dto';
import { QueryPersonalVocabStatsDto } from './dto/query-personal-vocab-stats.dto';
import { SubmitPersonalWordReviewDto } from './dto/submit-personal-word-review.dto';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

// Same reasoning as every other list/query DTO in this codebase: the
// app-wide ValidationPipe (main.ts) has no `transform`, so scope one
// locally to the query (see learning.controller.ts's identical pattern).
const queryPipe = new ValidationPipe({ transform: true });

@Controller('vocab-personal')
export class VocabPersonalController {
  constructor(private readonly vocabPersonal: VocabPersonalService) {}

  @UseGuards(JwtAuthGuard, VocabPersonalRateLimitGuard)
  @VocabPersonalRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('words')
  async list(
    @Query(queryPipe) query: QueryPersonalVocabWordsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vocabPersonal.list(req.user.userId, query);
  }

  @UseGuards(JwtAuthGuard, VocabPersonalRateLimitGuard)
  @VocabPersonalRateLimit({ kind: 'write', max: 300, windowSeconds: 600 })
  @Post('words')
  async create(
    @Body() dto: CreatePersonalVocabWordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vocabPersonal.create(req.user.userId, dto);
  }

  // Its own 'bulk' bucket, tighter and separate from 'write' — see
  // vocab-personal-rate-limits.decorator.ts's comment for why a single big
  // paste-import must not compete with the review-rating budget.
  @UseGuards(JwtAuthGuard, VocabPersonalRateLimitGuard)
  @VocabPersonalRateLimit({ kind: 'bulk', max: 10, windowSeconds: 60 })
  @Post('words/bulk')
  async bulkCreate(
    @Body() dto: BulkCreatePersonalVocabWordsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vocabPersonal.bulkCreate(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, VocabPersonalRateLimitGuard)
  @VocabPersonalRateLimit({ kind: 'write', max: 300, windowSeconds: 600 })
  @Patch('words/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonalVocabWordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vocabPersonal.update(req.user.userId, id, dto);
  }

  @UseGuards(JwtAuthGuard, VocabPersonalRateLimitGuard)
  @VocabPersonalRateLimit({ kind: 'write', max: 300, windowSeconds: 600 })
  @Delete('words/:id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.vocabPersonal.remove(req.user.userId, id);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard, VocabPersonalRateLimitGuard)
  @VocabPersonalRateLimit({ kind: 'write', max: 300, windowSeconds: 600 })
  @Post('words/:id/review')
  async submitReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPersonalWordReviewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vocabPersonal.submitReview(req.user.userId, id, dto);
  }

  // `tz` is optional and READ-ONLY here, same convention as
  // learning.controller.ts's libraries/progress route: buckets "today" for
  // dueTodayCount but never writes User.timezone.
  @UseGuards(JwtAuthGuard, VocabPersonalRateLimitGuard)
  @VocabPersonalRateLimit({ kind: 'read', max: 60, windowSeconds: 60 })
  @Get('stats')
  async getStats(
    @Query(queryPipe) query: QueryPersonalVocabStatsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vocabPersonal.getStats(req.user.userId, query.tz);
  }
}
