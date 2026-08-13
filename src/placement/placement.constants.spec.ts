import {
  DIFFICULTY_REQUIREMENTS,
  PLACEMENT_TIME_LIMIT_MS,
  QUESTIONS_PER_SECTION,
  TOTAL_QUESTIONS,
} from './placement.constants';

// Pins the multi-pillar roadmap revision's placement-test shape (24
// questions / 10 minutes / 3E-3M-2H per section) — a regression guard, not a
// design decision made here. See placement.constants.ts's own header for the
// content-ops sequencing this value change requires before deploy.
describe('placement test constants', () => {
  it('DIFFICULTY_REQUIREMENTS is 3 EASY / 3 MEDIUM / 2 HARD', () => {
    expect(DIFFICULTY_REQUIREMENTS).toEqual({ EASY: 3, MEDIUM: 3, HARD: 2 });
  });

  it('QUESTIONS_PER_SECTION is 8', () => {
    expect(QUESTIONS_PER_SECTION).toBe(8);
  });

  it('TOTAL_QUESTIONS is 24 (8 per section * 3 sections)', () => {
    expect(TOTAL_QUESTIONS).toBe(24);
  });

  it('PLACEMENT_TIME_LIMIT_MS is 10 minutes', () => {
    expect(PLACEMENT_TIME_LIMIT_MS).toBe(10 * 60 * 1000);
  });
});
