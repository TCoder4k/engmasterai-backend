import { CefrLevel, CourseType, QuestionType } from '@prisma/client';
import { gradeQuestion } from '../lesson/quiz/grade-question';
import { PLACEMENT_SECTIONS, QUESTIONS_PER_SECTION } from './placement.constants';

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
// answered) or no matching PlacementQuestion row (deleted after the attempt
// started) both fall through to "not counted correct", which is exactly the
// "absence = incorrect" contract the product spec asks for. No special
// casing needed beyond that fallthrough.
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

  for (const questionId of questionIds) {
    const question = questionById.get(questionId);
    if (!question) continue;
    if (!submittedByQuestionId.has(questionId)) continue;
    const submitted = submittedByQuestionId.get(questionId);
    const isCorrect = gradeQuestion(
      { type: question.type, correctAnswer: question.correctAnswer },
      submitted,
    );
    if (isCorrect) correctBySection[question.section] += 1;
  }

  const sectionScore = (section: CourseType) =>
    Math.round((correctBySection[section] / QUESTIONS_PER_SECTION) * 100);

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
  };
};
