import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';
import { QuizRateLimitGuard } from '../lesson/quiz/rate-limit/quiz-rate-limit.guard';
import { ListeningAdminController } from './listening-admin.controller';
import { ListeningCatalogController } from './listening-catalog.controller';
import { ListeningCategoryService } from './listening-category.service';
import { ListeningContentService } from './listening-content.service';
import { DictationController } from './dictation/dictation.controller';
import { DictationService } from './dictation/dictation.service';
import { ShadowingController } from './shadowing/shadowing.controller';
import { ShadowingService } from './shadowing/shadowing.service';
import { GeminiSpeechToTextProvider } from './shadowing/gemini-speech-to-text.provider';
import { SPEECH_TO_TEXT_PROVIDER } from './shadowing/speech-to-text.provider';
import { GeminiPronunciationFeedbackProvider } from './shadowing/gemini-pronunciation-feedback.provider';
import { PRONUNCIATION_FEEDBACK_PROVIDER } from './shadowing/pronunciation-feedback.provider';

// Sprint 11 — Listening content.
//
// WHY A TOP-LEVEL MODULE, NOT PART OF LessonModule. The rule lesson.module.ts
// states is that a feature lives where the collectors it COMPOSES already
// live. This composes none of them: a Listening recording has no Lesson, no
// LessonTask and no Question, and it is not owned by a Course. Folding it into
// LessonModule would put listening content behind the lesson engine's
// vocabulary for no shared code at all.
//
// It imports PrismaModule directly (not through another module), like
// GamificationModule and for the same reason: QuizRateLimitGuard needs
// nothing but Reflector and RateLimiterService, and AuthModule is @Global()
// and exports the latter. So the guard is declared as a PROVIDER here rather
// than obtained by importing LessonModule — which would drag the whole
// lesson engine in to reuse a forty-line guard.
//
// GamificationModule is imported so Dictation/Shadowing submitAttempt can
// call GamificationService.recordProgress() inside their own transaction —
// a submitted attempt now counts as a qualifying activity day, same as a
// quiz submission or an SRS review (see activity-window.ts). Safe in this
// direction only: GamificationModule imports PrismaModule and StreakModule,
// neither of which imports ListeningModule, so this stays a one-way edge.
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
  imports: [PrismaModule, GamificationModule],
  controllers: [
    ListeningCatalogController,
    ListeningAdminController,
    DictationController,
    ShadowingController,
  ],
  providers: [
    ListeningCategoryService,
    ListeningContentService,
    DictationService,
    ShadowingService,
    // Phase 4B — bound through a token, not by class. The token is what lets
    // e2e and unit tests substitute a fake engine; without it the entire
    // Shadowing write path would be untestable without a paid API call, which
    // in practice means untested.
    { provide: SPEECH_TO_TEXT_PROVIDER, useClass: GeminiSpeechToTextProvider },
    // Phase 4C — a SECOND token, bound to a second class, for a second job.
    // They are not one provider with two methods on purpose: only this one may
    // be told what the student was supposed to say, and keeping that difference
    // at the type level is what stops the reference sentence from ever reaching
    // the engine whose output is graded.
    {
      provide: PRONUNCIATION_FEEDBACK_PROVIDER,
      useClass: GeminiPronunciationFeedbackProvider,
    },
    QuizRateLimitGuard,
  ],
  exports: [ListeningContentService],
})
export class ListeningModule {}
