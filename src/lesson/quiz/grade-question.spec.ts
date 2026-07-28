import { gradeQuestion, validateQuestionContent } from './grade-question';

describe('grade-question — MULTIPLE_CHOICE', () => {
  const options = [
    { id: 'a', text: 'go' },
    { id: 'b', text: 'goes' },
  ];
  const correctAnswer = { optionId: 'b' };

  it('validates well-formed content', () => {
    expect(
      validateQuestionContent({
        type: 'MULTIPLE_CHOICE',
        options,
        correctAnswer,
      }),
    ).toBeNull();
  });

  it('rejects fewer than two options', () => {
    expect(
      validateQuestionContent({
        type: 'MULTIPLE_CHOICE',
        options: [options[0]],
        correctAnswer,
      }),
    ).not.toBeNull();
  });

  it('rejects a correctAnswer whose optionId is not among the options', () => {
    expect(
      validateQuestionContent({
        type: 'MULTIPLE_CHOICE',
        options,
        correctAnswer: { optionId: 'z' },
      }),
    ).not.toBeNull();
  });

  it('grades a matching optionId as correct', () => {
    expect(
      gradeQuestion(
        { type: 'MULTIPLE_CHOICE', correctAnswer },
        { optionId: 'b' },
      ),
    ).toBe(true);
  });

  it('grades a non-matching optionId as incorrect', () => {
    expect(
      gradeQuestion(
        { type: 'MULTIPLE_CHOICE', correctAnswer },
        { optionId: 'a' },
      ),
    ).toBe(false);
  });

  it('grades a malformed submission as incorrect, never throws', () => {
    expect(
      gradeQuestion(
        { type: 'MULTIPLE_CHOICE', correctAnswer },
        { garbage: true },
      ),
    ).toBe(false);
    expect(
      gradeQuestion({ type: 'MULTIPLE_CHOICE', correctAnswer }, null),
    ).toBe(false);
  });
});

describe('grade-question — TRUE_FALSE', () => {
  it('validates and grades correctly', () => {
    expect(
      validateQuestionContent({
        type: 'TRUE_FALSE',
        options: null,
        correctAnswer: { value: true },
      }),
    ).toBeNull();
    expect(
      gradeQuestion(
        { type: 'TRUE_FALSE', correctAnswer: { value: true } },
        { value: true },
      ),
    ).toBe(true);
    expect(
      gradeQuestion(
        { type: 'TRUE_FALSE', correctAnswer: { value: true } },
        { value: false },
      ),
    ).toBe(false);
  });

  it('rejects a non-boolean correctAnswer', () => {
    expect(
      validateQuestionContent({
        type: 'TRUE_FALSE',
        options: null,
        correctAnswer: { value: 'yes' },
      }),
    ).not.toBeNull();
  });
});

describe('grade-question — FILL_BLANK', () => {
  const correctAnswer = { accepted: ['colour', 'color'] };

  it('validates a non-empty accepted list', () => {
    expect(
      validateQuestionContent({
        type: 'FILL_BLANK',
        options: null,
        correctAnswer,
      }),
    ).toBeNull();
  });

  it('rejects an empty accepted list', () => {
    expect(
      validateQuestionContent({
        type: 'FILL_BLANK',
        options: null,
        correctAnswer: { accepted: [] },
      }),
    ).not.toBeNull();
  });

  it('normalises case and padding before comparing', () => {
    expect(
      gradeQuestion(
        { type: 'FILL_BLANK', correctAnswer },
        { text: '  COLOUR  ' },
      ),
    ).toBe(true);
    expect(
      gradeQuestion({ type: 'FILL_BLANK', correctAnswer }, { text: 'Color' }),
    ).toBe(true);
  });

  it('collapses internal whitespace before comparing', () => {
    expect(
      gradeQuestion(
        { type: 'FILL_BLANK', correctAnswer: { accepted: ['ice cream'] } },
        { text: 'ice   cream' },
      ),
    ).toBe(true);
  });

  it('rejects an unaccepted spelling', () => {
    expect(
      gradeQuestion({ type: 'FILL_BLANK', correctAnswer }, { text: 'colr' }),
    ).toBe(false);
  });
});

describe('grade-question — ORDERING', () => {
  const options = [
    { id: 'a', text: 'I' },
    { id: 'b', text: 'am' },
    { id: 'c', text: 'happy' },
  ];
  const correctAnswer = { orderedOptionIds: ['a', 'b', 'c'] };

  it("validates a permutation of the question's own option ids", () => {
    expect(
      validateQuestionContent({ type: 'ORDERING', options, correctAnswer }),
    ).toBeNull();
  });

  it('rejects a correctAnswer with a foreign option id', () => {
    expect(
      validateQuestionContent({
        type: 'ORDERING',
        options,
        correctAnswer: { orderedOptionIds: ['a', 'b', 'z'] },
      }),
    ).not.toBeNull();
  });

  it('rejects a correctAnswer with a duplicate id', () => {
    expect(
      validateQuestionContent({
        type: 'ORDERING',
        options,
        correctAnswer: { orderedOptionIds: ['a', 'a', 'c'] },
      }),
    ).not.toBeNull();
  });

  it('is order-sensitive: an exact match is correct', () => {
    expect(
      gradeQuestion(
        { type: 'ORDERING', correctAnswer },
        { orderedOptionIds: ['a', 'b', 'c'] },
      ),
    ).toBe(true);
  });

  it('is order-sensitive: the same ids in a different order are incorrect', () => {
    expect(
      gradeQuestion(
        { type: 'ORDERING', correctAnswer },
        { orderedOptionIds: ['b', 'a', 'c'] },
      ),
    ).toBe(false);
  });

  it('rejects a submission of the wrong length', () => {
    expect(
      gradeQuestion(
        { type: 'ORDERING', correctAnswer },
        { orderedOptionIds: ['a', 'b'] },
      ),
    ).toBe(false);
  });
});
