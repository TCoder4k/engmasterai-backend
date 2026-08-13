import { CefrLevel, CourseType, QuestionType } from '@prisma/client';
import { gradeQuestion } from '../lesson/quiz/grade-question';
import { PLACEMENT_SECTIONS } from './placement.constants';

// Pure scoring — no I/O, mirroring grade-question.ts's own discipline. The
// service layer is the only caller; it hands in whatever PlacementQuestion/
// PlacementAnswer rows it already fetched.

export interface ScoredQuestionSnapshot {
  id: string;
  section: CourseType;
  type: QuestionType;
  correctAnswer: unknown;
}

export interface ScoredAnswer {
  questionId: string;
  submitted: unknown;
}

export interface PlacementScoringResult {
  grammarScore: number;
  vocabularyScore: number;
  listeningScore: number;
  overallScore: number;
  estimatedLevel: CefrLevel;
  // Authoritative per-section counts backing the rounded percentages above —
  // a client must never re-derive "X of Y correct" from a rounded score
  // (e.g. round(63 / 100 * 8) happens to recover 5, but that's a coincidence
  // of the current 8-question divisor, not a guarantee). totalCount is this
  // attempt's own frozen composition (countBySection), the same one the
  // score's divisor already comes from — never the imported
  // QUESTIONS_PER_SECTION constant.
  grammarCorrect: number;
  grammarTotal: number;
  vocabularyCorrect: number;
  vocabularyTotal: number;
  listeningCorrect: number;
  listeningTotal: number;
}

// 0-19 A1, 20-39 A2, 40-59 B1, 60-79 B2, 80-100 C1. C2 is intentionally
// unreachable at this test's granularity (12 questions, 4 per section).
const LEVEL_THRESHOLDS: [minScore: number, level: CefrLevel][] = [
  [80, 'C1'],
  [60, 'B2'],
  [40, 'B1'],
  [20, 'A2'],
  [0, 'A1'],
];

export const estimateLevel = (overallScore: number): CefrLevel => {
  for (const [min, level] of LEVEL_THRESHOLDS) {
    if (overallScore >= min) return level;
  }
  return 'A1';
};

// Iterates the FROZEN questionIds list (the attempt's own order), never the
// answers list — a questionId with no matching PlacementAnswer row (never
// answered) falls through to "not counted correct", which is exactly the
// "absence = incorrect" contract the product spec asks for. No special
// casing needed beyond that fallthrough.
//
// The per-section DIVISOR is derived from this attempt's OWN frozen
// questionIds composition (countBySection below), never from the currently-
// imported QUESTIONS_PER_SECTION constant. That constant can change between
// deploys (see placement.constants.ts's own header) — an attempt sampled
// under an OLDER shape (e.g. 4 questions/section) that finalizes AFTER a
// deploy bumps the constant (e.g. to 8) must still be scored against the 4
// it actually had, not the 8 the new constant would imply. Using a snapshot
// of this attempt's real composition makes the score correct regardless of
// when it finalizes relative to any future constant change.
export const scorePlacementAttempt = (
  questionIds: string[],
  questions: ScoredQuestionSnapshot[],
  answers: ScoredAnswer[],
): PlacementScoringResult => {
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const submittedByQuestionId = new Map(
    answers.map((a) => [a.questionId, a.submitted]),
  );

  const correctBySection: Record<CourseType, number> = {
    GRAMMAR: 0,
    VOCABULARY: 0,
    LISTENING: 0,
  };
  const countBySection: Record<CourseType, number> = {
    GRAMMAR: 0,
    VOCABULARY: 0,
    LISTENING: 0,
  };

  for (const questionId of questionIds) {
    const question = questionById.get(questionId);
    if (!question) continue;
    countBySection[question.section] += 1;
    if (!submittedByQuestionId.has(questionId)) continue;
    const submitted = submittedByQuestionId.get(questionId);
    const isCorrect = gradeQuestion(
      { type: question.type, correctAnswer: question.correctAnswer },
      submitted,
    );
    if (isCorrect) correctBySection[question.section] += 1;
  }

  const sectionScore = (section: CourseType) =>
    countBySection[section] > 0
      ? Math.round((correctBySection[section] / countBySection[section]) * 100)
      : 0;

  const grammarScore = sectionScore('GRAMMAR');
  const vocabularyScore = sectionScore('VOCABULARY');
  const listeningScore = sectionScore('LISTENING');
  const overallScore = Math.round(
    (grammarScore + vocabularyScore + listeningScore) /
      PLACEMENT_SECTIONS.length,
  );

  return {
    grammarScore,
    vocabularyScore,
    listeningScore,
    overallScore,
    estimatedLevel: estimateLevel(overallScore),
    grammarCorrect: correctBySection.GRAMMAR,
    grammarTotal: countBySection.GRAMMAR,
    vocabularyCorrect: correctBySection.VOCABULARY,
    vocabularyTotal: countBySection.VOCABULARY,
    listeningCorrect: correctBySection.LISTENING,
    listeningTotal: countBySection.LISTENING,
  };
};
