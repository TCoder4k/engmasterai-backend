import { generateRoadmap, RoadmapCourseCandidate } from './roadmap-algorithm';

const course = (
  id: string,
  type: 'GRAMMAR' | 'VOCABULARY' | 'LISTENING',
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null,
  createdAt: Date,
): RoadmapCourseCandidate => ({ id, type, level, createdAt });

describe('generateRoadmap', () => {
  it('beginner-skip path (estimatedLevel null): presents sections in the fixed order, earliest course per section', () => {
    const courses = [
      course('g-old', 'GRAMMAR', 'A1', new Date('2024-01-01')),
      course('g-new', 'GRAMMAR', 'A1', new Date('2024-06-01')),
      course('v1', 'VOCABULARY', null, new Date('2024-01-01')),
      course('l1', 'LISTENING', 'B1', new Date('2024-01-01')),
    ];
    const items = generateRoadmap(
      { goal: 'FOUNDATION', estimatedLevel: null, sectionScores: {} },
      courses,
    );
    expect(items.map((i) => i.courseType)).toEqual(['GRAMMAR', 'VOCABULARY', 'LISTENING']);
    expect(items.map((i) => i.phase)).toEqual([1, 2, 3]);
    expect(items[0].courseId).toBe('g-old'); // earliest-authored wins when level is unknown
  });

  it('orders sections weakest-first when estimatedLevel is known', () => {
    const courses = [
      course('g1', 'GRAMMAR', 'B1', new Date('2024-01-01')),
      course('v1', 'VOCABULARY', 'B1', new Date('2024-01-01')),
      course('l1', 'LISTENING', 'B1', new Date('2024-01-01')),
    ];
    const items = generateRoadmap(
      {
        goal: 'TOEIC_450',
        estimatedLevel: 'B1',
        sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
      },
      courses,
    );
    // VOCABULARY (25%) is weakest -> phase 1, then LISTENING (50%), then
    // GRAMMAR (75%) last.
    expect(items.map((i) => i.courseType)).toEqual(['VOCABULARY', 'LISTENING', 'GRAMMAR']);
    expect(items[0].reason).toContain('Weakest');
  });

  it('picks the course whose level is closest to the estimated level', () => {
    const courses = [
      course('g-a1', 'GRAMMAR', 'A1', new Date('2024-01-01')),
      course('g-b2', 'GRAMMAR', 'B2', new Date('2024-01-01')),
      course('g-b1', 'GRAMMAR', 'B1', new Date('2024-01-01')),
    ];
    const items = generateRoadmap(
      { goal: 'TOEIC_450', estimatedLevel: 'B1', sectionScores: { GRAMMAR: 50 } },
      courses,
    );
    expect(items.find((i) => i.courseType === 'GRAMMAR')?.courseId).toBe('g-b1');
  });

  it('falls back to earliest-authored when no course in a section has a level set', () => {
    const courses = [
      course('g-new', 'GRAMMAR', null, new Date('2024-06-01')),
      course('g-old', 'GRAMMAR', null, new Date('2024-01-01')),
    ];
    const items = generateRoadmap(
      { goal: 'TOEIC_450', estimatedLevel: 'B1', sectionScores: { GRAMMAR: 50 } },
      courses,
    );
    expect(items[0].courseId).toBe('g-old');
  });

  it('omits a section entirely when no published course of that type exists — never crashes', () => {
    const courses = [course('g1', 'GRAMMAR', 'A1', new Date())];
    const items = generateRoadmap(
      { goal: 'TOEIC_450', estimatedLevel: 'A1', sectionScores: {} },
      courses,
    );
    expect(items).toHaveLength(1);
    expect(items[0].courseType).toBe('GRAMMAR');
  });

  it('phase numbers are contiguous starting at 1 even when a section is omitted', () => {
    const courses = [
      course('g1', 'GRAMMAR', 'A1', new Date()),
      course('l1', 'LISTENING', 'A1', new Date()),
    ];
    const items = generateRoadmap(
      { goal: 'TOEIC_450', estimatedLevel: 'A1', sectionScores: {} },
      courses,
    );
    expect(items.map((i) => i.phase)).toEqual([1, 2]);
  });

  describe('consolidation phase', () => {
    it('adds a 4th phase revisiting the weakest section one level up, after the other three', () => {
      const courses = [
        course('g1', 'GRAMMAR', 'B1', new Date('2024-01-01')),
        course('v1', 'VOCABULARY', 'B1', new Date('2024-01-01')),
        course('v2-b2', 'VOCABULARY', 'B2', new Date('2024-01-01')),
        course('l1', 'LISTENING', 'B1', new Date('2024-01-01')),
      ];
      const items = generateRoadmap(
        {
          goal: 'TOEIC_450',
          estimatedLevel: 'B1',
          sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
        },
        courses,
      );
      // VOCABULARY is weakest (phase 1) -> consolidation revisits VOCABULARY
      // at B2, as the LAST phase.
      expect(items).toHaveLength(4);
      const last = items[items.length - 1];
      expect(last.phase).toBe(4);
      expect(last.courseType).toBe('VOCABULARY');
      expect(last.courseId).toBe('v2-b2');
      expect(last.reason).toContain('Consolidation');
    });

    it('never recommends the SAME course twice for the consolidation phase', () => {
      const courses = [
        course('g1', 'GRAMMAR', 'B1', new Date('2024-01-01')),
        course('v1', 'VOCABULARY', 'B1', new Date('2024-01-01')), // only B1 available
        course('l1', 'LISTENING', 'B1', new Date('2024-01-01')),
      ];
      const items = generateRoadmap(
        {
          goal: 'TOEIC_450',
          estimatedLevel: 'B1',
          sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
        },
        courses,
      );
      // No OTHER Vocabulary course at B2 exists -> consolidation is omitted
      // rather than recommending v1 (phase 1's own course) again.
      expect(items).toHaveLength(3);
    });

    it('omits consolidation entirely on the beginner-skip path (no weakest section to reinforce)', () => {
      const courses = [
        course('g1', 'GRAMMAR', 'A1', new Date('2024-01-01')),
        course('g2-a2', 'GRAMMAR', 'A2', new Date('2024-01-01')),
      ];
      const items = generateRoadmap(
        { goal: 'FOUNDATION', estimatedLevel: null, sectionScores: {} },
        courses,
      );
      expect(items).toHaveLength(1);
    });

    it('omits consolidation when the estimated level is already C2 (nowhere higher to go)', () => {
      const courses = [
        course('g1', 'GRAMMAR', 'C2', new Date('2024-01-01')),
        course('v1', 'VOCABULARY', 'C2', new Date('2024-01-01')), // weakest, but already at the ceiling
        course('l1', 'LISTENING', 'C2', new Date('2024-01-01')),
      ];
      const items = generateRoadmap(
        {
          goal: 'TOEIC_800',
          estimatedLevel: 'C2',
          sectionScores: { GRAMMAR: 80, VOCABULARY: 10, LISTENING: 50 },
        },
        courses,
      );
      expect(items).toHaveLength(3); // one per section, no 4th consolidation phase
      expect(items.every((i) => !i.reason.includes('Consolidation'))).toBe(true);
    });
  });
});
