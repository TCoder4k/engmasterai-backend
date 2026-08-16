// Phase C — the "trusted context projection" shapes.
//
// The principle (docs/CLAUDE.md's Phase C notes): it is NOT "send content or
// don't" — it is "the SERVER decides which content is safe to send". These
// interfaces are the enforcement of that: each is a CLOSED allowlist shape.
// There is no field here that could ever hold `LessonTask`/`Question`/a
// correct answer — not because a check remembers to exclude one, but
// because the type has nowhere to put it. See chat-context.resolver.spec.ts
// for a compile-time test pinning this.

export const LESSON_CONTEXT_STAGES = [
  'video',
  'theory',
  'quiz',
  'traphunter',
  'practice',
] as const;

export type LessonContextStage = (typeof LESSON_CONTEXT_STAGES)[number];

export type ChatContextInput =
  | { type: 'GENERAL' }
  | { type: 'LESSON'; resourceId: string; stage?: LessonContextStage }
  | { type: 'VOCAB_WORD'; resourceId: string };

/**
 * Allowlisted lesson fields only. `theoryExcerpt` is populated ONLY for the
 * video/theory stages (see chat-context.resolver.ts) — at quiz/traphunter/
 * practice there is no field here to carry anything at all, because the
 * lesson's actual content AT those stages is the graded question bank
 * itself, and nothing about that bank is safe to hand to a model.
 */
export interface LessonContextProjection {
  title: string;
  description: string | null;
  learningObjectives: string[];
  theoryExcerpt?: string;
}

export interface VocabWordContextProjection {
  word: string;
  ipa: string | null;
  viMeaning: string | null;
  exampleEn: string | null;
}
