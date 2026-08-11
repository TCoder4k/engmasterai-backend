import { estimateLevel, scorePlacementAttempt } from './placement-scoring';

const question = (
  id: string,
  section: 'GRAMMAR' | 'VOCABULARY' | 'LISTENING',
  correctValue: boolean,
) => ({
  id,
  section,
  type: 'TRUE_FALSE' as const,
  correctAnswer: { value: correctValue },
});

describe('estimateLevel', () => {
  it.each([
    [0, 'A1'],
    [19, 'A1'],
    [20, 'A2'],
    [39, 'A2'],
    [40, 'B1'],
    [59, 'B1'],
    [60, 'B2'],
    [79, 'B2'],
    [80, 'C1'],
    [100, 'C1'],
  ])('maps overallScore %i to %s', (score, expected) => {
    expect(estimateLevel(score)).toBe(expected);
  });

  it('never returns C2 — unreachable at this test size', () => {
    expect(estimateLevel(100)).not.toBe('C2');
  });
});

describe('scorePlacementAttempt', () => {
  const questionIds = ['g1', 'g2', 'g3', 'g4', 'v1', 'v2', 'v3', 'v4', 'l1', 'l2', 'l3', 'l4'];
  const questions = [
    question('g1', 'GRAMMAR', true),
    question('g2', 'GRAMMAR', true),
    question('g3', 'GRAMMAR', true),
    question('g4', 'GRAMMAR', true),
    question('v1', 'VOCABULARY', true),
    question('v2', 'VOCABULARY', true),
    question('v3', 'VOCABULARY', true),
    question('v4', 'VOCABULARY', true),
    question('l1', 'LISTENING', true),
    question('l2', 'LISTENING', true),
    question('l3', 'LISTENING', true),
    question('l4', 'LISTENING', true),
  ];

  it('scores every section 100 and overall 100 when every question is answered correctly', () => {
    const answers = questionIds.map((questionId) => ({
      questionId,
      submitted: { value: true },
    }));
    const result = scorePlacementAttempt(questionIds, questions, answers);
    expect(result).toEqual({
      grammarScore: 100,
      vocabularyScore: 100,
      listeningScore: 100,
      overallScore: 100,
      estimatedLevel: 'C1',
    });
  });

  it('treats an unanswered question as incorrect — no special casing beyond absence', () => {
    // Only g1 answered (correctly); g2-g4 never submitted at all.
    const answers = [{ questionId: 'g1', submitted: { value: true } }];
    const result = scorePlacementAttempt(questionIds, questions, answers);
    expect(result.grammarScore).toBe(25);
    expect(result.vocabularyScore).toBe(0);
    expect(result.listeningScore).toBe(0);
    expect(result.overallScore).toBe(8); // round((25+0+0)/3)
  });

  it('treats a question deleted after the attempt started as incorrect, same as unanswered', () => {
    const questionsMissingOne = questions.filter((q) => q.id !== 'g1');
    const answers = [{ questionId: 'g1', submitted: { value: true } }];
    const result = scorePlacementAttempt(questionIds, questionsMissingOne, answers);
    expect(result.grammarScore).toBe(0);
  });

  it('a wrong submission scores incorrect without throwing', () => {
    const answers = [{ questionId: 'g1', submitted: { value: false } }];
    const result = scorePlacementAttempt(questionIds, questions, answers);
    expect(result.grammarScore).toBe(0);
  });

  it('an unrecognized submission shape grades as incorrect, never throws (mirrors grade-question.ts)', () => {
    const answers = [{ questionId: 'g1', submitted: { garbage: true } }];
    expect(() => scorePlacementAttempt(questionIds, questions, answers)).not.toThrow();
    const result = scorePlacementAttempt(questionIds, questions, answers);
    expect(result.grammarScore).toBe(0);
  });
});
