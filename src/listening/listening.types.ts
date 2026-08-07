import {
  CefrLevel,
  ListeningMediaProvider,
  ListeningMediaType,
  ListeningMode,
} from '@prisma/client';

// Sprint 11 — the response shapes.
//
// THE STUDENT AND ADMIN SEGMENT SHAPES ARE DIFFERENT TYPES, not one type with
// optional fields. Two fields must never reach a student:
//
//   normalizedText — the exact string a future attempt will be graded against.
//                    Shipping it would hand the client the answer key to the
//                    comparison, and it has no rendering use whatsoever.
//   notes          — the author's working notes.
//
// Making them structurally absent is the same technique STUDENT_QUESTION_SELECT
// uses for correctAnswer/explanation in the quiz engine: a field that does not
// exist on the type cannot be leaked by a forgotten `select`.

export interface ListeningCategoryDto {
  id: string;
  name: string;
  nameVi: string;
  orderIndex: number;
}

/** Admin view — carries publication state and how much content is underneath. */
export interface ManageListeningCategoryDto extends ListeningCategoryDto {
  isPublished: boolean;
  contentCount: number;
}

/** A catalog card. No segments — the list ships counts, not transcripts. */
export interface ListeningCardDto {
  id: string;
  title: string;
  description: string | null;
  level: CefrLevel;
  thumbnailUrl: string | null;
  durationMs: number | null;
  segmentCount: number;
  supportedModes: ListeningMode[];
  sourceName: string | null;
  category: ListeningCategoryDto;
}

export interface StudentListeningSegmentDto {
  id: string;
  orderIndex: number;
  text: string;
  ipa: string | null;
  translationVi: string | null;
  startTimeMs: number;
  endTimeMs: number;
}

export interface ListeningContentDetailDto {
  id: string;
  title: string;
  description: string | null;
  level: CefrLevel;
  thumbnailUrl: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  mediaType: ListeningMediaType;
  mediaProvider: ListeningMediaProvider;
  mediaUrl: string;
  externalMediaId: string | null;
  durationMs: number | null;
  supportedModes: ListeningMode[];
  category: ListeningCategoryDto;
  segments: StudentListeningSegmentDto[];
}

export interface ManageListeningSegmentDto extends StudentListeningSegmentDto {
  notes: string | null;
}

export interface ManageListeningContentDto {
  id: string;
  title: string;
  description: string | null;
  level: CefrLevel;
  thumbnailUrl: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  mediaType: ListeningMediaType;
  mediaProvider: ListeningMediaProvider;
  mediaUrl: string;
  externalMediaId: string | null;
  durationMs: number | null;
  supportedModes: ListeningMode[];
  orderIndex: number;
  isPublished: boolean;
  categoryId: string;
  category: ManageListeningCategoryDto;
  segmentCount: number;
  segments: ManageListeningSegmentDto[];
  createdAt: Date;
  updatedAt: Date;
}

/** Row shape for the admin content list — no segments, same as the card. */
export interface ManageListeningContentSummaryDto {
  id: string;
  title: string;
  level: CefrLevel;
  mediaProvider: ListeningMediaProvider;
  mediaType: ListeningMediaType;
  supportedModes: ListeningMode[];
  orderIndex: number;
  isPublished: boolean;
  segmentCount: number;
  category: ListeningCategoryDto & { isPublished: boolean };
  updatedAt: Date;
}

export interface PaginationMetaDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListeningCatalogResponseDto {
  data: ListeningCardDto[];
  meta: PaginationMetaDto;
  /**
   * Every category that currently HAS visible content, with a real count.
   *
   * Derived from the same publication predicate the list uses, so a chip can
   * never advertise a number the grid cannot produce. A category with nothing
   * published is absent rather than shown as `(0)` — an empty section is a
   * dead end for the student and an accidental disclosure that drafts exist.
   */
  categories: (ListeningCategoryDto & { contentCount: number })[];
}

/* ── Sprint 11 Phase 4A — Dictation progress ─────────────────────────────── */

/**
 * One student's standing on one sentence.
 *
 * Only sentences the student has actually attempted appear. There is no row of
 * zeroes for an untouched sentence: absence IS "not started", and inventing a
 * placeholder would make "has this student begun?" a question about field
 * values instead of about row existence.
 */
export interface DictationSegmentProgressDto {
  segmentId: string;
  completedAt: Date | null;
  bestAccuracyPercent: number | null;
  attemptCount: number;
  assisted: boolean;
}

/**
 * Content-level Dictation standing, DERIVED on every read.
 *
 * `completedSegments` is counted against the live segment list at request
 * time; it is not stored anywhere. That is what lets an admin add a sentence
 * to a finished recording and have every student's card correctly drop back to
 * in-progress, with no counter to recount and no backfill.
 */
export interface ListeningDictationSummaryDto {
  totalSegments: number;
  completedSegments: number;
  completed: boolean;
  /**
   * The most recent attempt on any sentence of this recording, or null when
   * the student has never attempted one.
   *
   * There is deliberately no `startedAt` beside it. `min(lastAttemptAt)` would
   * be the obvious derivation and it would be WRONG -- that column is
   * overwritten on every attempt -- and the accurate source (the append-only
   * attempt table) costs a query nothing currently reads.
   */
  lastActivityAt: Date | null;
}

/** The batch catalog read: one entry per requested, still-visible recording. */
export interface ListeningProgressSummaryDto {
  contentId: string;
  /** Null when the recording does not enable DICTATION at all. */
  dictation: ListeningDictationSummaryDto | null;
}

/**
 * What a submitted attempt returns.
 *
 * Carries the recalculated segment row AND the recalculated content summary so
 * the client can update both without a second request — and, more importantly,
 * so it never has to compute either itself.
 */
export interface SubmitDictationAttemptResultDto {
  accuracyPercent: number;
  wordsCorrect: number;
  wordsTotal: number;
  solved: boolean;
  assisted: boolean;
  segment: DictationSegmentProgressDto;
  content: ListeningDictationSummaryDto;
}

/** The content-detail block: the derived summary plus the per-sentence rows. */
export interface ListeningDictationProgressDto extends ListeningDictationSummaryDto {
  segments: DictationSegmentProgressDto[];
}

/**
 * What `GET /listening/contents/:id` actually returns.
 *
 * Content PLUS the reader's progress, and they are separate types on purpose:
 * `ListeningContentDetailDto` is a fact about a recording, this is a fact
 * about a recording *and a student*. Keeping the progress out of the content
 * service's return type is what stops that service from ever needing to know
 * who is asking.
 */
export interface StudentListeningContentResponseDto extends ListeningContentDetailDto {
  /** Null when the recording does not enable DICTATION at all. */
  dictationProgress: ListeningDictationProgressDto | null;
  /** Null when the recording does not enable SHADOWING at all. */
  shadowingProgress: ShadowingSegmentProgressDto[] | null;
}

/* ── Shadowing (Phase 4B) ───────────────────────────────────────────────── */

/**
 * One student's standing on one sentence, for Shadowing.
 *
 * No `assisted`: there is no hint mechanism in speaking, and carrying a field
 * that is always false would imply one exists. This is the concrete reason the
 * two modes did not get a shared progress table.
 */
export interface ShadowingSegmentProgressDto {
  segmentId: string;
  completedAt: Date | null;
  bestAccuracyPercent: number | null;
  attemptCount: number;
}

/**
 * Content-level Shadowing standing, DERIVED on every read — the same shape and
 * the same reasoning as ListeningDictationSummaryDto. Nothing here is stored:
 * `completedSegments` is counted against the live segment list at request
 * time, so an admin adding a sentence to a finished recording correctly drops
 * it back to in-progress for every student, with no counter to recount.
 */
export interface ListeningShadowingSummaryDto {
  totalSegments: number;
  completedSegments: number;
  completed: boolean;
  /** The most recent attempt on any sentence of this recording, or null. */
  lastActivityAt: Date | null;
}

/** The batch catalog read for Shadowing: one entry per requested, still-visible recording. */
export interface ListeningShadowingProgressSummaryDto {
  contentId: string;
  /** Null when the recording does not enable SHADOWING at all. */
  shadowing: ListeningShadowingSummaryDto | null;
}

/** One aligned word pair. Produced by the server; the client only renders it. */
export interface ShadowingAlignmentTokenDto {
  op: 'MATCH' | 'SUBSTITUTE' | 'INSERT' | 'DELETE';
  reference: string | null;
  spoken: string | null;
  referenceIndex: number | null;
}

/**
 * What a submitted shadowing attempt returns.
 *
 * `transcript` is the RAW engine output, deliberately: showing a student the
 * normalized form would present "dont" for "don't" as though that is what they
 * said. The normalized text is included as well because it is what the
 * alignment ran on, and a score that cannot be traced to its input is not
 * explainable.
 *
 * There is no audio URL here and there is nowhere for one to come from.
 */
export interface SubmitShadowingAttemptResultDto {
  transcript: string;
  normalizedTranscript: string;
  alignment: ShadowingAlignmentTokenDto[];
  accuracyPercent: number;
  wordsCorrect: number;
  wordsTotal: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  passed: boolean;
  /** Recorded per attempt so tuning the threshold cannot rewrite old verdicts. */
  passThresholdPercent: number;
  segment: ShadowingSegmentProgressDto;
}

/**
 * Sprint 11 Phase 4C — AI pronunciation coaching for one attempt.
 *
 * NO NUMBER OF ANY KIND. Not an accuracy, not a confidence, not a rating out of
 * five. The attempt already carries one figure, computed from the alignment,
 * and a second one produced by a model that heard a single clip would be a
 * fabricated measurement standing beside a real one — indistinguishable to the
 * student, and wrong.
 *
 * `cached` is not a performance detail: it tells the client this is the SAME
 * advice as last time rather than a fresh opinion, which is the honest answer
 * to "why does it say exactly what it said before".
 */
export interface ShadowingFeedbackResultDto {
  feedback: string;
  generatedAt: Date;
  model: string;
  cached: boolean;
}
