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
      grammarCorrect: 4,
      grammarTotal: 4,
      vocabularyCorrect: 4,
      vocabularyTotal: 4,
      listeningCorrect: 4,
      listeningTotal: 4,
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

  // Regression guard for the cross-deploy correctness hazard: the divisor
  // must come from THIS attempt's own frozen questionIds composition, never
  // from the currently-imported QUESTIONS_PER_SECTION constant (which can
  // change between deploys — see placement.constants.ts). Deliberately uses
  // a GRAMMAR count (2) that matches neither the old (4) nor the new (8)
  // constant value, so this test would fail loudly if the implementation
  // ever silently reintroduced a dependency on the imported constant.
  it("derives the per-section divisor from the attempt's own question composition, not the imported constant", () => {
    const twoGrammarQuestionIds = ['g1', 'g2'];
    const twoGrammarQuestions = [
      question('g1', 'GRAMMAR', true),
      question('g2', 'GRAMMAR', true),
    ];
    const answers = [{ questionId: 'g1', submitted: { value: true } }];
    const result = scorePlacementAttempt(twoGrammarQuestionIds, twoGrammarQuestions, answers);
    expect(result.grammarScore).toBe(50); // 1/2, not 1/4 (old) or 1/8 (new)
  });

  it('scores 0, not NaN, when every question for a section was deleted after the attempt started', () => {
    const result = scorePlacementAttempt(
      ['g1'],
      [], // g1's row is gone entirely
      [{ questionId: 'g1', submitted: { value: true } }],
    );
    expect(result.grammarScore).toBe(0);
    expect(Number.isNaN(result.grammarScore)).toBe(false);
  });
});

// Regression guard for the ResultStep bug: the frontend used to infer
// "X of Y correct" from the rounded percentage under a stale 4-question/
// section, 25%-increment assumption (correct = round(score / 25)). That
// broke the moment sections grew to 8 questions — e.g. 63% (5/8) inferred
// back to round(63/25)=3, not 5. The fix is authoritative counts straight
// from scoring, never re-derived from a rounded percentage on either side.
describe('scorePlacementAttempt — per-section correct/total counts (8 questions/section)', () => {
  const eightGrammarQuestionIds = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'];
  const eightGrammarQuestions = eightGrammarQuestionIds.map((id) =>
    question(id, 'GRAMMAR', true),
  );

  const scoreNCorrectOfEight = (correctCount: number) => {
    const answers = eightGrammarQuestionIds.slice(0, correctCount).map((questionId) => ({
      questionId,
      submitted: { value: true },
    }));
    return scorePlacementAttempt(eightGrammarQuestionIds, eightGrammarQuestions, answers);
  };

  it('5/8 correct scores 63% (not 25%-increment-derived) and reports the real 5/8 count', () => {
    const result = scoreNCorrectOfEight(5);
    expect(result.grammarScore).toBe(63); // 5/8 = 62.5%, rounds to 63
    expect(result.grammarCorrect).toBe(5);
    expect(result.grammarTotal).toBe(8);
  });

  it('7/8 correct scores 88% and reports the real 7/8 count', () => {
    const result = scoreNCorrectOfEight(7);
    expect(result.grammarScore).toBe(88); // 7/8 = 87.5%, rounds to 88
    expect(result.grammarCorrect).toBe(7);
    expect(result.grammarTotal).toBe(8);
  });

  it('8/8 correct scores 100% and reports the real 8/8 count', () => {
    const result = scoreNCorrectOfEight(8);
    expect(result.grammarScore).toBe(100);
    expect(result.grammarCorrect).toBe(8);
    expect(result.grammarTotal).toBe(8);
  });
});
