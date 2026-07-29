import { QuestionType } from '@prisma/client';
import { buildTrapHints, countTrapHints, HintableQuestion } from './trap-hints';

// Sprint 06C. The hint ladder is pure, so it is unit-testable in full — no
// database, no fixtures, no HTTP. These tests exist mainly to pin the two
// properties that are easy to break by "improving" a hint:
//
//   1. A hint NEVER resolves to the answer. Every narrower has a guard for
//      the degenerate case (two options, a one-letter blank), and losing one
//      turns a hint into a giveaway silently.
//   2. Nothing is invented. A level with no authored source is not offered,
//      full stop — no generated text, no filler, no empty rung.

const mc = (over: Partial<HintableQuestion> = {}): HintableQuestion => ({
  id: 'question-1',
  type: QuestionType.MULTIPLE_CHOICE,
  options: [
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Bravo' },
    { id: 'c', text: 'Charlie' },
    { id: 'd', text: 'Delta' },
  ],
  correctAnswer: { optionId: 'a' },
  explanation: null,
  ...over,
});

describe('buildTrapHints', () => {
  describe('Level 1 — MULTIPLE_CHOICE narrowing', () => {
    it('strikes out half the distractors and never the correct option', () => {
      const [hint] = buildTrapHints(mc());
      expect(hint.kind).toBe('narrow');
      if (hint.payload.shape !== 'eliminate')
        throw new Error('expected eliminate');
      // 3 distractors -> ceil(3/2) = 2 eliminated, 2 options left standing.
      expect(hint.payload.optionIds).toHaveLength(2);
      expect(hint.payload.optionIds).not.toContain('a');
    });

    it('always leaves at least one distractor, so the hint is never the answer', () => {
      const [hint] = buildTrapHints(mc());
      if (hint.payload.shape !== 'eliminate')
        throw new Error('expected eliminate');
      const remaining = 4 - hint.payload.optionIds.length;
      expect(remaining).toBeGreaterThanOrEqual(2);
    });

    it('offers NO narrowing for a two-option question — eliminating the only distractor IS the answer', () => {
      const question = mc({
        options: [
          { id: 'a', text: 'Alpha' },
          { id: 'b', text: 'Bravo' },
        ],
      });
      expect(buildTrapHints(question).some((h) => h.kind === 'narrow')).toBe(
        false,
      );
    });

    it('eliminates the same options every time, so refreshing cannot reveal more', () => {
      const first = buildTrapHints(mc())[0];
      const second = buildTrapHints(mc())[0];
      expect(first.payload).toEqual(second.payload);
    });

    it('narrows differently for a different question (the seed is the question id)', () => {
      // Not a correctness property, just proof the seed is actually used —
      // a constant shuffle would pass the determinism test above too.
      const seeds = new Set(
        ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((id) => {
          const [hint] = buildTrapHints(mc({ id }));
          return hint.payload.shape === 'eliminate'
            ? [...hint.payload.optionIds].sort().join(',')
            : '';
        }),
      );
      expect(seeds.size).toBeGreaterThan(1);
    });
  });

  describe('Level 1 — the other three types', () => {
    it('reveals only the first option for ORDERING', () => {
      const [hint] = buildTrapHints(
        mc({
          type: QuestionType.ORDERING,
          correctAnswer: { orderedOptionIds: ['c', 'a', 'b', 'd'] },
        }),
      );
      expect(hint.payload).toEqual({ shape: 'firstOption', optionId: 'c' });
    });

    it('offers no ORDERING hint for two options — naming the first names both', () => {
      const question = mc({
        type: QuestionType.ORDERING,
        options: [
          { id: 'a', text: 'Alpha' },
          { id: 'b', text: 'Bravo' },
        ],
        correctAnswer: { orderedOptionIds: ['b', 'a'] },
      });
      expect(countTrapHints(question)).toBe(0);
    });

    it('describes the SHORTEST accepted spelling for FILL_BLANK', () => {
      const [hint] = buildTrapHints(
        mc({
          type: QuestionType.FILL_BLANK,
          options: null,
          correctAnswer: { accepted: ['has been', 'been'] },
        }),
      );
      expect(hint.payload).toEqual({
        shape: 'letters',
        length: 4,
        firstCharacter: 'b',
      });
    });

    it('offers no FILL_BLANK hint for a one-letter answer', () => {
      const question = mc({
        type: QuestionType.FILL_BLANK,
        options: null,
        correctAnswer: { accepted: ['a'] },
      });
      expect(countTrapHints(question)).toBe(0);
    });

    it('offers NO Level 1 at all for TRUE_FALSE — there is nothing to narrow but the answer', () => {
      const question = mc({
        type: QuestionType.TRUE_FALSE,
        options: null,
        correctAnswer: { value: true },
        explanation: 'Because the subject is singular.',
      });
      const hints = buildTrapHints(question);
      expect(hints).toHaveLength(1);
      expect(hints[0].kind).toBe('explanation');
    });
  });

  describe('Level 2 — the authored explanation, or nothing', () => {
    it('offers the explanation verbatim when one was written', () => {
      const hints = buildTrapHints(
        mc({ explanation: 'Adverbs modify verbs.' }),
      );
      expect(hints[1].payload).toEqual({
        shape: 'explanation',
        text: 'Adverbs modify verbs.',
      });
    });

    it('offers nothing when no explanation was authored — never a generated substitute', () => {
      const hints = buildTrapHints(mc({ explanation: null }));
      expect(hints.every((hint) => hint.kind !== 'explanation')).toBe(true);
    });

    it('treats a whitespace-only explanation as absent', () => {
      expect(countTrapHints(mc({ explanation: '   ' }))).toBe(1);
    });
  });

  describe('the ladder itself', () => {
    it('numbers levels contiguously from 1, so a missing rung never leaves a gap', () => {
      // TRUE_FALSE has no Level 1, so its explanation must be offered as
      // Level 1 rather than as an unreachable Level 2.
      const hints = buildTrapHints(
        mc({
          type: QuestionType.TRUE_FALSE,
          options: null,
          correctAnswer: { value: false },
          explanation: 'Only one of these is a clause.',
        }),
      );
      expect(hints.map((hint) => hint.level)).toEqual([1]);
    });

    it('returns an empty ladder when nothing is authored — the client shows no hint control', () => {
      const question = mc({
        type: QuestionType.TRUE_FALSE,
        options: null,
        correctAnswer: { value: true },
        explanation: null,
      });
      expect(buildTrapHints(question)).toEqual([]);
    });

    it('survives malformed stored content without throwing', () => {
      // correctAnswer comes out of a Json column; a question authored by an
      // older version must degrade to "no hint", never to a 500 in front of
      // a student.
      expect(() => buildTrapHints(mc({ correctAnswer: null }))).not.toThrow();
      expect(countTrapHints(mc({ correctAnswer: 'nonsense' }))).toBe(0);
    });
  });
});
