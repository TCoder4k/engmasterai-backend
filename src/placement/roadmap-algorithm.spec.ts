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
});
