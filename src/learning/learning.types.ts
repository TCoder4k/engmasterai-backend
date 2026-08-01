import { LearningState } from '@prisma/client';
import { PreviewIntervals } from './srs/scheduler';

// The authoritative progress fields the frontend renders — never
// recomputed client-side (sprint plan §9's "frontend must not calculate
// scheduling" constraint). Identical whether returned from a fresh
// submission or an idempotent replay (§10).
export interface ReviewResponseDto {
  state: LearningState;
  intervalDays: number;
  nextReviewAt: Date;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  version: number;
  // Sprint 10. Safe inline: this DTO is DERIVED from WordReviewLog by
  // snapshotResponse on every call, never stored as a blob, so a replay
  // reconstructs it and can report xpAwarded: 0 honestly. Compare
  // SubmitQuizResponseDto, which IS persisted verbatim and therefore had to
  // keep gamification in a sibling field instead.
  gamification: import('../gamification/gamification.types').GamificationResultDto;
}

export interface DueQueueWordDto {
  id: string;
  text: string;
  ipa: string | null;
  cefrLevel: string | null;
  audioUrl: string | null;
  imageUrl: string | null;
  meanings: {
    id: string;
    partOfSpeech: string | null;
    meaning: string;
    orderIndex: number;
  }[];
}

export interface DueQueueItemDto {
  word: DueQueueWordDto;
  isNew: boolean;
  progress: {
    state: LearningState;
    intervalDays: number;
    nextReviewAt: Date;
    easeFactor: number;
    repetitions: number;
    lapses: number;
  } | null;
  previewIntervals: PreviewIntervals;
}

export interface DueQueueResponseDto {
  data: DueQueueItemDto[];
}

// Sprint 04D — real deck/library progress (§13). `startedPercent` measures
// exposure (words rated at least once), not learning quality — see
// docs/adr/007-learning-engine-srs.md for why it is deliberately not named
// "progressPercent" and why a weighted "learningProgressPercent" is
// deferred rather than invented here. `masteredPercent` (added in the same
// sprint's UI-repair follow-up) is the one percentage that IS a direct
// quality signal — `masteredWords / totalWords` — so the UI can show both
// "how much have you touched" and "how much have you actually learned" as
// two distinct numbers instead of one bar trying to mean both.
export interface DeckProgressDto {
  deckId: string;
  totalWords: number;
  newWords: number;
  learningWords: number;
  reviewWords: number;
  masteredWords: number;
  dueWords: number;
  startedPercent: number;
  masteredPercent: number;
}

export interface LibraryProgressDto {
  libraryId: string;
  totalWords: number;
  newWords: number;
  learningWords: number;
  reviewWords: number;
  masteredWords: number;
  dueWords: number;
  startedPercent: number;
  masteredPercent: number;
  // Per-deck breakdown in the same one request — avoids the library
  // detail page making one HTTP round trip per deck row (a real concern:
  // the TOEIC 600 dataset alone has 50 decks in one library).
  //
  // Counting rule (stated explicitly, not left implicit — see
  // docs/adr/007-learning-engine-srs.md): each DeckProgressDto.totalWords
  // counts unique wordIds WITHIN that deck; this LibraryProgressDto's own
  // totalWords counts unique wordIds across every published deck in the
  // library. A word attached to two decks is counted in EACH deck's total
  // but only ONCE at the library level, so `sum(decks[].totalWords)` can
  // legitimately exceed `totalWords` here — that is not a bug. Progress
  // itself is per (userId, wordId), never per deck, so the word's state is
  // identical in both decks regardless.
  decks: DeckProgressDto[];
}

// Sprint 04D — the library grid (VocabLibraryPage) needs real counts for
// EVERY published library in one request, not the per-library detail shape
// above (which would be one round trip per card). A summary, not the full
// per-deck breakdown — that only matters once a student has opened a
// specific library.
export interface LibrarySummaryProgressDto {
  libraryId: string;
  deckCount: number;
  totalWords: number;
  newWords: number;
  learningWords: number;
  reviewWords: number;
  masteredWords: number;
  dueWords: number;
  startedPercent: number;
  masteredPercent: number;
}

// Sprint 09 follow-up — the daily NEW-word allowance, which is per-user and
// per-day, NOT per-library, so it sits beside `data` rather than inside it.
//
// WHY THIS EXISTS. The dashboard's review card summed `dueWords` and told the
// student "23 từ đang chờ", then opening the session showed "Còn lại: 38". Both
// numbers were correct and they answered different questions: `dueWords` counts
// only words with an EXISTING UserWordProgress row that has come due, while the
// review queue is topped up with NEW words the student has never rated. The
// difference — 15 — had no representation anywhere in the API, so no client
// could have explained it.
export interface DailyNewWordsDto {
  /** The per-day cap on newly introduced words. */
  dailyLimit: number;
  /** Already introduced today, in the user's own timezone. */
  introducedToday: number;
  /**
   * How many new words a session started NOW would actually hand out:
   * `min(remaining quota, words never rated)`.
   *
   * This is the number to add to `dueWords` to predict the queue length. It can
   * still overstate by a hair in one case: the queue also caps its total at
   * DEFAULT_QUEUE_LIMIT (200), so a student with 200+ due words gets fewer new
   * ones than this. Not modelled here — at 200 due words the review card has
   * bigger things to say.
   */
  availableNow: number;
}

export interface LibrarySummaryProgressResponseDto {
  data: LibrarySummaryProgressDto[];
  dailyNewWords: DailyNewWordsDto;
}
