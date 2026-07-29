import {
  PracticePrerequisiteInput,
  resolvePracticePrerequisites,
} from './practice-prerequisites';

// Sprint 06D. The resolver is pure, so the whole prerequisite chain is
// testable without a database, HTTP or a fixture.
//
// The case these tests exist for is the FIRST one below. An earlier draft of
// this sprint gated Advanced Practice on "the quiz is passed" alone, which
// meant a lesson carrying a Practice task and no quiz had a required stage
// that could never be satisfied — permanently blocked, lesson stuck below
// 100%, and nothing in the UI to explain why. A missing prerequisite must
// never create an impossible one.

const input = (
  over: Partial<PracticePrerequisiteInput> = {},
): PracticePrerequisiteInput => ({
  hasPublishedQuiz: true,
  quizPassed: true,
  trapsTotal: 0,
  trapsCleared: 0,
  ...over,
});

describe('resolvePracticePrerequisites', () => {
  describe('a lesson with no published quiz', () => {
    it('is available immediately — there is nothing to pass', () => {
      expect(
        resolvePracticePrerequisites(
          input({ hasPublishedQuiz: false, quizPassed: false }),
        ),
      ).toEqual({ met: true });
    });

    it('ignores trap counts entirely, however they arrive', () => {
      // Traps are derived from a quiz attempt and from nothing else, so with
      // no quiz these numbers are meaningless — they must not be able to
      // block a stage. Guards against a caller passing stale counts.
      expect(
        resolvePracticePrerequisites(
          input({
            hasPublishedQuiz: false,
            quizPassed: false,
            trapsTotal: 5,
            trapsCleared: 0,
          }),
        ),
      ).toEqual({ met: true });
    });
  });

  describe('a lesson with a published quiz', () => {
    it('blocks with quiz_not_passed until the quiz is passed', () => {
      expect(
        resolvePracticePrerequisites(input({ quizPassed: false })),
      ).toEqual({ met: false, reason: 'quiz_not_passed' });
    });

    it('blocks with traps_outstanding while any trap is uncleared', () => {
      expect(
        resolvePracticePrerequisites(input({ trapsTotal: 3, trapsCleared: 2 })),
      ).toEqual({ met: false, reason: 'traps_outstanding' });
    });

    it('reports the quiz first when BOTH are unmet — it is the earlier stage', () => {
      // Telling a student to clear traps they cannot reach yet would send
      // them to a stage that is itself blocked.
      expect(
        resolvePracticePrerequisites(
          input({ quizPassed: false, trapsTotal: 3, trapsCleared: 0 }),
        ),
      ).toEqual({ met: false, reason: 'quiz_not_passed' });
    });

    it('is available after a perfect attempt — zero traps is not "outstanding"', () => {
      expect(resolvePracticePrerequisites(input({ trapsTotal: 0 }))).toEqual({
        met: true,
      });
    });

    it('is available once every trap is cleared', () => {
      expect(
        resolvePracticePrerequisites(input({ trapsTotal: 3, trapsCleared: 3 })),
      ).toEqual({ met: true });
    });

    it('treats an over-count of cleared traps as met, never as blocked', () => {
      // A question deleted by an author after the attempt can leave cleared
      // above total. That must resolve to "done", not strand the student.
      expect(
        resolvePracticePrerequisites(input({ trapsTotal: 2, trapsCleared: 5 })),
      ).toEqual({ met: true });
    });
  });
});
