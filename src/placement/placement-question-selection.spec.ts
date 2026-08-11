import {
  InsufficientQuestionBankError,
  PublishedQuestionRef,
  sampleQuestionIds,
} from './placement-question-selection';

const bucket = (
  section: 'GRAMMAR' | 'VOCABULARY' | 'LISTENING',
  difficulty: 'EASY' | 'MEDIUM' | 'HARD',
  count: number,
): PublishedQuestionRef[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${section}-${difficulty}-${i}`,
    section,
    difficulty,
  }));

const fullBank = (): PublishedQuestionRef[] => [
  ...bucket('GRAMMAR', 'EASY', 5),
  ...bucket('GRAMMAR', 'MEDIUM', 3),
  ...bucket('GRAMMAR', 'HARD', 2),
  ...bucket('VOCABULARY', 'EASY', 5),
  ...bucket('VOCABULARY', 'MEDIUM', 3),
  ...bucket('VOCABULARY', 'HARD', 2),
  ...bucket('LISTENING', 'EASY', 5),
  ...bucket('LISTENING', 'MEDIUM', 3),
  ...bucket('LISTENING', 'HARD', 2),
];

describe('sampleQuestionIds', () => {
  it('returns exactly 12 ids from a well-stocked bank', () => {
    const ids = sampleQuestionIds(fullBank());
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12); // no duplicates
  });

  it('returns ids in the fixed product order: Grammar -> Vocabulary -> Listening, Easy -> Hard within each block', () => {
    const published = fullBank();
    const byId = new Map(published.map((q) => [q.id, q]));
    const ids = sampleQuestionIds(published);
    const sections = ids.map((id) => byId.get(id)!.section);
    const difficulties = ids.map((id) => byId.get(id)!.difficulty);

    expect(sections).toEqual([
      'GRAMMAR', 'GRAMMAR', 'GRAMMAR', 'GRAMMAR',
      'VOCABULARY', 'VOCABULARY', 'VOCABULARY', 'VOCABULARY',
      'LISTENING', 'LISTENING', 'LISTENING', 'LISTENING',
    ]);
    // 2 EASY / 1 MEDIUM / 1 HARD within each section's block.
    expect(difficulties.slice(0, 4)).toEqual(['EASY', 'EASY', 'MEDIUM', 'HARD']);
  });

  it('works with a bank at EXACTLY the minimum required count (no slack)', () => {
    const minimal = [
      ...bucket('GRAMMAR', 'EASY', 2),
      ...bucket('GRAMMAR', 'MEDIUM', 1),
      ...bucket('GRAMMAR', 'HARD', 1),
      ...bucket('VOCABULARY', 'EASY', 2),
      ...bucket('VOCABULARY', 'MEDIUM', 1),
      ...bucket('VOCABULARY', 'HARD', 1),
      ...bucket('LISTENING', 'EASY', 2),
      ...bucket('LISTENING', 'MEDIUM', 1),
      ...bucket('LISTENING', 'HARD', 1),
    ];
    const ids = sampleQuestionIds(minimal);
    expect(ids).toHaveLength(12);
    expect(new Set(ids)).toEqual(new Set(minimal.map((q) => q.id)));
  });

  it('throws InsufficientQuestionBankError naming the short bucket when one bucket is short', () => {
    const short = fullBank().filter(
      (q) => !(q.section === 'LISTENING' && q.difficulty === 'HARD'),
    );
    expect(() => sampleQuestionIds(short)).toThrow(InsufficientQuestionBankError);
    try {
      sampleQuestionIds(short);
      fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientQuestionBankError);
      const err = error as InsufficientQuestionBankError;
      expect(err.section).toBe('LISTENING');
      expect(err.difficulty).toBe('HARD');
      expect(err.available).toBe(0);
      expect(err.required).toBe(1);
    }
  });
});
