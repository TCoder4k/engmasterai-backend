import { QuestionType } from '@prisma/client';

// Sprint 06B — the single place question correctness is decided. Every
// grader here is a PURE function: no I/O, no Prisma, nothing async. The
// service layer is the only caller, and it never grades a question any
// other way — this is what makes Invariant 9 (the student GET never carries
// `correctAnswer`) meaningful: correctness computation and correctness
// *disclosure* are the same tiny, auditable surface.
//
// "The Quiz Engine must never assume Grammar." Nothing below reads a
// question's content string or cares what subject it's from — only its
// `type`, its authored `options`/`correctAnswer`, and the student's
// submission.

export interface QuestionOption {
  id: string;
  text: string;
}

// The four authored correctAnswer shapes, keyed by QuestionType. Options
// carry stable ids (never array positions) so ORDERING options can be
// shuffled server-side per request without leaking the answer order.
export type MultipleChoiceAnswer = { optionId: string };
export type TrueFalseAnswer = { value: boolean };
export type FillBlankAnswer = { accepted: string[] };
export type OrderingAnswer = { orderedOptionIds: string[] };

// The four submitted-answer shapes a student's client sends. FILL_BLANK's
// submission is a single free-text string, not the authored `accepted` list.
export type MultipleChoiceSubmission = { optionId: string };
export type TrueFalseSubmission = { value: boolean };
export type FillBlankSubmission = { text: string };
export type OrderingSubmission = { orderedOptionIds: string[] };

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// FILL_BLANK normalisation: trim, lowercase, collapse internal whitespace to
// a single space. Deliberately no accent/diacritic folding — "form" and
// "form " should match, but silently accepting a different word is not this
// function's job.
const normalizeFillBlank = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const optionIdSet = (options: QuestionOption[] | null): Set<string> =>
  new Set((options ?? []).map((o) => o.id));

// One grader per QuestionType. `validateContent` is called at SAVE time
// (the admin PUT) — malformed authored content is rejected before it can
// ever reach a student. `grade` is called at SUBMIT time against an
// already-validated question, so it never throws; a submission whose shape
// doesn't match the expected one is simply incorrect, never a 500.
interface QuestionGrader {
  validateContent(
    options: QuestionOption[] | null,
    correctAnswer: unknown,
  ): string | null;
  grade(correctAnswer: unknown, submitted: unknown): boolean;
}

const multipleChoiceGrader: QuestionGrader = {
  validateContent(options, correctAnswer) {
    if (!options || options.length < 2) {
      return 'MULTIPLE_CHOICE questions need at least two options.';
    }
    if (
      !isPlainObject(correctAnswer) ||
      !isNonEmptyString(correctAnswer.optionId)
    ) {
      return 'MULTIPLE_CHOICE correctAnswer must be { optionId: string }.';
    }
    if (!optionIdSet(options).has(correctAnswer.optionId)) {
      return "MULTIPLE_CHOICE correctAnswer.optionId must match one of the question's own options.";
    }
    return null;
  },
  grade(correctAnswer, submitted) {
    const answer = correctAnswer as MultipleChoiceAnswer;
    if (!isPlainObject(submitted) || !isNonEmptyString(submitted.optionId))
      return false;
    return submitted.optionId === answer.optionId;
  },
};

const trueFalseGrader: QuestionGrader = {
  validateContent(_options, correctAnswer) {
    if (
      !isPlainObject(correctAnswer) ||
      typeof correctAnswer.value !== 'boolean'
    ) {
      return 'TRUE_FALSE correctAnswer must be { value: boolean }.';
    }
    return null;
  },
  grade(correctAnswer, submitted) {
    const answer = correctAnswer as TrueFalseAnswer;
    if (!isPlainObject(submitted) || typeof submitted.value !== 'boolean')
      return false;
    return submitted.value === answer.value;
  },
};

const fillBlankGrader: QuestionGrader = {
  validateContent(_options, correctAnswer) {
    if (
      !isPlainObject(correctAnswer) ||
      !isStringArray(correctAnswer.accepted) ||
      correctAnswer.accepted.length === 0 ||
      correctAnswer.accepted.some((a) => !isNonEmptyString(a))
    ) {
      return 'FILL_BLANK correctAnswer must be { accepted: string[] } with at least one non-empty spelling.';
    }
    return null;
  },
  grade(correctAnswer, submitted) {
    const answer = correctAnswer as FillBlankAnswer;
    if (!isPlainObject(submitted) || typeof submitted.text !== 'string')
      return false;
    const submittedNormalized = normalizeFillBlank(submitted.text);
    return answer.accepted.some(
      (a) => normalizeFillBlank(a) === submittedNormalized,
    );
  },
};

const orderingGrader: QuestionGrader = {
  validateContent(options, correctAnswer) {
    if (!options || options.length < 2) {
      return 'ORDERING questions need at least two options.';
    }
    if (
      !isPlainObject(correctAnswer) ||
      !isStringArray(correctAnswer.orderedOptionIds)
    ) {
      return 'ORDERING correctAnswer must be { orderedOptionIds: string[] }.';
    }
    const ids = optionIdSet(options);
    const ordered = correctAnswer.orderedOptionIds;
    if (
      ordered.length !== options.length ||
      new Set(ordered).size !== ordered.length
    ) {
      return "ORDERING correctAnswer.orderedOptionIds must be a permutation of the question's own option ids.";
    }
    if (!ordered.every((id) => ids.has(id))) {
      return "ORDERING correctAnswer.orderedOptionIds must only reference the question's own option ids.";
    }
    return null;
  },
  grade(correctAnswer, submitted) {
    const answer = correctAnswer as OrderingAnswer;
    if (!isPlainObject(submitted) || !isStringArray(submitted.orderedOptionIds))
      return false;
    const submittedOrder = submitted.orderedOptionIds;
    if (submittedOrder.length !== answer.orderedOptionIds.length) return false;
    return submittedOrder.every(
      (id, index) => id === answer.orderedOptionIds[index],
    );
  },
};

const GRADERS: Record<QuestionType, QuestionGrader> = {
  MULTIPLE_CHOICE: multipleChoiceGrader,
  TRUE_FALSE: trueFalseGrader,
  FILL_BLANK: fillBlankGrader,
  ORDERING: orderingGrader,
};

// Called by the admin PUT before any write reaches the database — a
// malformed question (correctAnswer that doesn't match its type, an
// optionId that isn't among the question's own options) fails at save time,
// never silently at grade time in front of a student. Returns an error
// message, or null when the content is valid.
export const validateQuestionContent = (question: {
  type: QuestionType;
  options: QuestionOption[] | null;
  correctAnswer: unknown;
}): string | null =>
  GRADERS[question.type].validateContent(
    question.options,
    question.correctAnswer,
  );

// Called by the submit endpoint against already-validated content. Never
// throws — an unexpected submission shape (a stale client, a hand-crafted
// request) is graded as incorrect, not a 500.
export const gradeQuestion = (
  question: { type: QuestionType; correctAnswer: unknown },
  submitted: unknown,
): boolean => GRADERS[question.type].grade(question.correctAnswer, submitted);
