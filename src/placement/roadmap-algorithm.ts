import { CefrLevel, CourseType, LearningGoal } from '@prisma/client';
import { PLACEMENT_SECTIONS } from './placement.constants';

// Pure function, no I/O — mirrors grade-question.ts/placement-scoring.ts's
// own discipline. PlacementService is the only caller; it loads courses and
// hands them in.
//
// PHASE 3 SCOPE NOTE: this is the minimal version needed to make finalize's
// "onboardedAt is set only once a Roadmap successfully generates" contract
// real and testable (see placement.service.ts's finalizeNow) — weak-section-
// first ordering plus Course.level matching, no consolidation phase. Phase 4
// owns refining this further and building GET /placement/roadmap's live
// Course join; the wiring built here (start-beginner/finalize calling this
// function, persisting `items`) does not need to change for that.

export interface RoadmapCourseCandidate {
  id: string;
  type: CourseType;
  level: CefrLevel | null;
  createdAt: Date;
}

export interface RoadmapItem {
  phase: number;
  courseType: CourseType;
  courseId: string;
  reason: string;
}

export interface GenerateRoadmapInput {
  goal: LearningGoal;
  // Null on the beginner-skip path (no test was ever taken) — every section
  // is then presented in the fixed PLACEMENT_SECTIONS order rather than
  // sorted by a score that doesn't exist.
  estimatedLevel: CefrLevel | null;
  sectionScores: Partial<Record<CourseType, number>>;
}

const LEVEL_ORDER: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// Prefers the course whose level is closest to the student's estimated
// level (ties broken toward the earliest-authored course, the same implicit
// "earlier-authored = more foundational" fallback GrammarCourseCard already
// uses). Falls back to earliest-authored when no course in this section has
// a level set yet — Course.level adoption is still in progress (see the
// plan's Risks section), and an unleveled catalog must still produce SOME
// roadmap rather than an empty one.
const pickCourse = (
  type: CourseType,
  estimatedLevel: CefrLevel | null,
  courses: RoadmapCourseCandidate[],
): RoadmapCourseCandidate | null => {
  const inSection = courses.filter((c) => c.type === type);
  if (inSection.length === 0) return null;

  const byCreatedAt = (a: RoadmapCourseCandidate, b: RoadmapCourseCandidate) =>
    a.createdAt.getTime() - b.createdAt.getTime();

  if (estimatedLevel === null) {
    return [...inSection].sort(byCreatedAt)[0];
  }

  const leveled = inSection.filter(
    (c): c is RoadmapCourseCandidate & { level: CefrLevel } => c.level !== null,
  );
  if (leveled.length === 0) {
    return [...inSection].sort(byCreatedAt)[0];
  }

  const targetIndex = LEVEL_ORDER.indexOf(estimatedLevel);
  return [...leveled].sort((a, b) => {
    const distanceA = Math.abs(LEVEL_ORDER.indexOf(a.level) - targetIndex);
    const distanceB = Math.abs(LEVEL_ORDER.indexOf(b.level) - targetIndex);
    return distanceA !== distanceB ? distanceA - distanceB : byCreatedAt(a, b);
  })[0];
};

// Sections are always presented weakest-first (see the sort above), so only
// phase 1's text says "weakest" — later phases describe their own score
// without implying every phase is also the weakest one.
const buildReason = (
  section: CourseType,
  phase: number,
  estimatedLevel: CefrLevel | null,
  sectionScores: Partial<Record<CourseType, number>>,
): string => {
  if (estimatedLevel === null) {
    return `Starting point for ${section.toLowerCase()}.`;
  }
  const score = sectionScores[section] ?? 0;
  return phase === 1
    ? `Weakest section (${score}%) — recommended first.`
    : `Reinforcing ${section.toLowerCase()} (${score}%).`;
};

export const generateRoadmap = (
  input: GenerateRoadmapInput,
  availableCourses: RoadmapCourseCandidate[],
): RoadmapItem[] => {
  const orderedSections =
    input.estimatedLevel === null
      ? [...PLACEMENT_SECTIONS]
      : [...PLACEMENT_SECTIONS].sort(
          (a, b) => (input.sectionScores[a] ?? 0) - (input.sectionScores[b] ?? 0),
        );

  const items: RoadmapItem[] = [];
  let phase = 1;
  for (const section of orderedSections) {
    const course = pickCourse(section, input.estimatedLevel, availableCourses);
    // No published course of this type exists yet — the item is omitted,
    // not a crash. A short catalog is a content gap (see the plan's Risks
    // section), not a reason to fail roadmap generation entirely.
    if (!course) continue;
    items.push({
      phase,
      courseType: section,
      courseId: course.id,
      reason: buildReason(section, phase, input.estimatedLevel, input.sectionScores),
    });
    phase += 1;
  }
  return items;
};
