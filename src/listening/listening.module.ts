import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { ListeningAdminController } from './listening-admin.controller';
import { ListeningCatalogController } from './listening-catalog.controller';
import { ListeningCategoryService } from './listening-category.service';
import { ListeningContentService } from './listening-content.service';
import { DictationController } from './dictation/dictation.controller';
import { DictationService } from './dictation/dictation.service';

// Sprint 11 — Listening content.
//
// WHY A TOP-LEVEL MODULE, NOT PART OF LessonModule. The rule lesson.module.ts
// states is that a feature lives where the collectors it COMPOSES already
// live. This composes none of them: a Listening recording has no Lesson, no
// LessonTask and no Question, and it is not owned by a Course. Folding it into
// LessonModule would put listening content behind the lesson engine's
// vocabulary for no shared code at all.
//
// It imports ONLY PrismaModule, like GamificationModule and for the same
// reason: QuizRateLimitGuard needs nothing but Reflector and
// RateLimiterService, and AuthModule is @Global() and exports the latter. So
// the guard is declared as a PROVIDER here rather than obtained by importing
// LessonModule — which would drag the whole lesson engine in to reuse a
// forty-line guard.
//
// >>> KNOWN, PRE-EXISTING DEBT, DELIBERATELY NOT FIXED HERE <<<
// That guard and its decorator live under `src/lesson/quiz/rate-limit/`, and
// this module is now the SIXTH importer from outside `src/lesson` (analytics,
// gamification, study-time and their modules are the others). It has become a
// shared concern sitting in a feature folder — the same shape as
// `timezone.util.ts` living under `src/learning/` with four consumers across
// four domains. Moving it to `src/shared/rate-limit/` is cleanup-sprint work:
// it touches six files in five modules and belongs in a change that is only
// that, not smuggled into a feature sprint.
@Module({
  imports: [PrismaModule],
  controllers: [
    ListeningCatalogController,
    ListeningAdminController,
    DictationController,
  ],
  providers: [
    ListeningCategoryService,
    ListeningContentService,
    DictationService,
    QuizRateLimitGuard,
  ],
  exports: [ListeningContentService],
})
export class ListeningModule {}
