import { QuestionType } from '@prisma/client';
import { QuestionOption } from './grade-question';
import { seededShuffle } from './seeded-shuffle';

// Sprint 06C — Trap Hunter's progressive hints.
//
// PURE: no I/O, no Prisma, nothing async — the same contract grade-question.ts
// holds, and for the same reason. Correctness *disclosure* stays a tiny,
// auditable surface.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: nothing here is invented. Every hint
// is computed from content a teacher actually authored — the question's own
// `correctAnswer` and `options` for Level 1, the authored `explanation` for
// Level 2. There is no generated text anywhere in this module and none may
// be added. A level with no real source is simply not offered, which is why
// buildTrapHints returns a LIST rather than a fixed four-rung ladder: a
// TRUE_FALSE question with no authored explanation yields an empty array,
// and the client renders no hint button at all rather than an empty one.
//
// Levels are contiguous and 1-based (the array index + 1), so a question
// whose only hint is its explanation offers that explanation as Level 1.
// `hintLevel` on the stored state therefore means "how many levels this
// student has unlocked", never "which rung of a fixed ladder".
//
// USING A HINT NEVER PENALISES ANYTHING. It cannot prevent, delay or
// annotate a trap being cleared, and `hintLevel` is recorded for future
// analytics only. Trap Hunter evaluates correction, not exam integrity — a
// student who reads the explanation and then fixes their mistake has done
// exactly what this stage is for. Do not add a "solved unaided" distinction,
// a score reduction, or a completion gate on top of this value.

export type TrapHintKind = 'narrow' | 'explanation';

// Discriminated on `shape` so the client renders each without guessing from
// the question type — a hint is self-describing.
export type TrapHintPayload =
  // MULTIPLE_CHOICE — option ids to strike out. Never includes the correct
  // one, and always leaves at least one distractor standing.
  | { shape: 'eliminate'; optionIds: string[] }
  // ORDERING — which option genuinely goes first.
  | { shape: 'firstOption'; optionId: string }
  // FILL_BLANK — the shape of the shortest accepted answer.
  | { shape: 'letters'; length: number; firstCharacter: string }
  // The authored explanation, verbatim.
  | { shape: 'explanation'; text: string };

export interface TrapHint {
  level: number;
  kind: TrapHintKind;
  payload: TrapHintPayload;
}

export interface HintableQuestion {
  id: string;
  type: QuestionType;
  options: QuestionOption[] | null;
  correctAnswer: unknown;
  explanation: string | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// --- Level 1: structural narrowing -------------------------------------------
//
// One derivation per QuestionType, each returning null when narrowing would
// give the answer away outright. That guard is the whole point: a hint that
// resolves to "the answer is X" is not a hint, and "hints never reveal the
// full answer immediately" is a requirement, not a preference.

const narrowMultipleChoice = (
  question: HintableQuestion,
): TrapHintPayload | null => {
  const options = question.options ?? [];
  if (!isPlainObject(question.correctAnswer)) return null;
  const correctId = question.correctAnswer.optionId;
  if (typeof correctId !== 'string') return null;

  const distractorIds = options
    .map((option) => option.id)
    .filter((id) => id !== correctId);

  // Halve the field, but never past the point where the correct option is
  // the only one left: with 2 options there is exactly 1 distractor, so
  // eliminating it IS the answer. n - 2 keeps at least one distractor.
  const eliminateCount = Math.min(
    Math.ceil(distractorIds.length / 2),
    options.length - 2,
  );
  if (eliminateCount < 1) return null;

  // Seeded by the question id so the SAME distractors are struck out on
  // every request. An unseeded pick would reveal a different subset on each
  // refresh, and a student who reloaded enough times would be left with only
  // the correct answer standing.
  return {
    shape: 'eliminate',
    optionIds: seededShuffle(distractorIds, question.id).slice(
      0,
      eliminateCount,
    ),
  };
};

const narrowOrdering = (question: HintableQuestion): TrapHintPayload | null => {
  if (!isPlainObject(question.correctAnswer)) return null;
  const ordered = question.correctAnswer.orderedOptionIds;
  if (!Array.isArray(ordered) || typeof ordered[0] !== 'string') return null;
  // With two options, naming the first names the second as well.
  if (ordered.length < 3) return null;
  return { shape: 'firstOption', optionId: ordered[0] };
};

const narrowFillBlank = (
  question: HintableQuestion,
): TrapHintPayload | null => {
  if (!isPlainObject(question.correctAnswer)) return null;
  const accepted = question.correctAnswer.accepted;
  if (!Array.isArray(accepted)) return null;
  const words = accepted.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (words.length === 0) return null;

  // The SHORTEST accepted spelling: the most forgiving target, and the one
  // whose length is least likely to mislead.
  const shortest = words.reduce((a, b) => (b.length < a.length ? b : a));
  // A one-character answer has no shape to describe without being the
  // answer.
  if (shortest.length < 2) return null;

  return {
    shape: 'letters',
    length: shortest.length,
    firstCharacter: shortest[0],
  };
};

// TRUE_FALSE is deliberately absent. There is nothing to narrow between two
// options that is not simply the answer, so a true/false trap offers Level 1
// to nobody — see the KIND-completeness test in trap-hints.spec.ts.
const NARROWERS: Record<
  QuestionType,
  ((question: HintableQuestion) => TrapHintPayload | null) | null
> = {
  MULTIPLE_CHOICE: narrowMultipleChoice,
  TRUE_FALSE: null,
  FILL_BLANK: narrowFillBlank,
  ORDERING: narrowOrdering,
};

// --- The ladder ---------------------------------------------------------------

// Every hint this question can actually offer, in order, renumbered so the
// levels are contiguous. An empty array means "no hint button at all".
export const buildTrapHints = (question: HintableQuestion): TrapHint[] => {
  const hints: TrapHint[] = [];

  const narrower = NARROWERS[question.type];
  const narrowed = narrower ? narrower(question) : null;
  if (narrowed) hints.push({ level: 0, kind: 'narrow', payload: narrowed });

  // Authored or nothing. An empty/whitespace explanation is treated as
  // absent, matching QuizReviewList's own truthiness gate on the frontend —
  // an author who left the field blank did not write a hint.
  const explanation = question.explanation?.trim();
  if (explanation) {
    hints.push({
      level: 0,
      kind: 'explanation',
      payload: { shape: 'explanation', text: explanation },
    });
  }

  return hints.map((hint, index) => ({ ...hint, level: index + 1 }));
};

export const countTrapHints = (question: HintableQuestion): number =>
  buildTrapHints(question).length;
