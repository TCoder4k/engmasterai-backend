import { LearningState } from '@prisma/client';

// The row shape returned by every list/create/update/get response —
// deliberately omits `userId` (the caller already knows who they are) and
// `easeFactor`/`version` are kept since the frontend's flashcard/dictation
// components need them to know a word's current scheduling state without a
// second request; PersonalWordReviewResponseDto below restates the subset
// that changes after a rating.
export interface PersonalVocabWordDto {
  id: string;
  text: string;
  ipa: string | null;
  meaningVi: string;
  meaningEn: string | null;
  audioUrl: string | null;
  exampleSentence: string | null;
  exampleTranslation: string | null;
  tags: string[];
  state: LearningState;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  nextReviewAt: Date | null;
  firstLearnedAt: Date | null;
  masteredAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonalVocabWordListResponseDto {
  data: PersonalVocabWordDto[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Deliberately no `gamification` field, unlike learning's ReviewResponseDto —
// this feature does not award XP for personal-word reviews (never asked for,
// and doing it right needs its own anti-farming design, same reasoning
// wordMasteredAward's keying gives for the curated-deck path — that's a
// follow-up if the owner wants it, not fabricated here).
export interface PersonalWordReviewResponseDto {
  state: LearningState;
  intervalDays: number;
  nextReviewAt: Date;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  version: number;
}

export interface BulkCreatePersonalVocabWordsResponseDto {
  createdCount: number;
  skippedCount: number;
  skippedWords: string[];
}

// GET /vocab-personal/words/status's response — every requested text (keyed
// by its normalized form, same as `textNormalized`) gets an entry, including
// unsaved ones, so a caller never has to special-case "missing from the map"
// vs "checked and not saved".
export type PersonalVocabWordSavedStatusDto = Record<
  string,
  { saved: true; id: string } | { saved: false }
>;

export interface PersonalVocabStatsDto {
  total: number;
  mastered: number;
  learning: number;
  new: number;
  dueTodayCount: number;
  // `lapses > 0` — a real, cheap column, not fabricated. See the model
  // comment on PersonalVocabWord.
  struggledCount: number;
  reviewsLast7Days: { date: string; count: number }[];
}
