import { CourseType, QuestionDifficulty } from '@prisma/client';
import {
  DIFFICULTY_REQUIREMENTS,
  PLACEMENT_SECTIONS,
} from './placement.constants';

export interface PublishedQuestionRef {
  id: string;
  section: CourseType;
  difficulty: QuestionDifficulty;
}

// Thrown by sampleQuestionIds when a (section, difficulty) bucket has fewer
// published questions than DIFFICULTY_REQUIREMENTS needs. The service layer
// turns this into the PLACEMENT_BANK_INCOMPLETE 503 — kept as a plain class
// (not a Nest exception) so this file stays framework-free and unit-testable
// with no Nest bootstrap.
export class InsufficientQuestionBankError extends Error {
  constructor(
    public readonly section: CourseType,
    public readonly difficulty: QuestionDifficulty,
    public readonly required: number,
    public readonly available: number,
  ) {
    super(
      `PLACEMENT_BANK_INCOMPLETE: ${section}/${difficulty} needs ${required} published questions, has ${available}.`,
    );
  }
}

// Fisher-Yates. Plain Math.random is fine here — this picks which published
// questions appear in a test, not a security-sensitive secret, and (unlike
// grade-question.ts's ORDERING shuffle) nothing about this needs to be
// reproducible from a seed.
const shuffle = <T>(items: T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

// Samples the fixed 12-question shape and returns ids in the product's fixed
// display order — Grammar -> Vocabulary -> Listening, Easy -> Hard within
// each section's block — since PLACEMENT_SECTIONS and
// DIFFICULTY_REQUIREMENTS are iterated in that order. This return value is
// frozen verbatim into PlacementAttempt.questionIds, so sampling and
// ordering happen in the same pass rather than as a separate reorder step.
//
// Throws InsufficientQuestionBankError on the FIRST short bucket rather than
// collecting every shortfall — POST /placement/start only needs to know
// "can't build a test right now", and the admin coverage endpoint
// (PlacementQuestionService.getCoverage) is the tool for the full picture.
export const sampleQuestionIds = (
  published: PublishedQuestionRef[],
): string[] => {
  const ids: string[] = [];
  for (const section of PLACEMENT_SECTIONS) {
    for (const difficulty of Object.keys(
      DIFFICULTY_REQUIREMENTS,
    ) as QuestionDifficulty[]) {
      const required = DIFFICULTY_REQUIREMENTS[difficulty];
      const bucket = published.filter(
        (q) => q.section === section && q.difficulty === difficulty,
      );
      if (bucket.length < required) {
        throw new InsufficientQuestionBankError(
          section,
          difficulty,
          required,
          bucket.length,
        );
      }
      ids.push(...shuffle(bucket).slice(0, required).map((q) => q.id));
    }
  }
  return ids;
};
