import { CourseType } from '@prisma/client';
import { RoadmapItem } from './roadmap-algorithm';

// Legacy compat — a READER, not a data migration. Pre-multi-pillar Roadmap
// rows persisted items as { phase, courseType, courseId, reason } (Course-
// only). Rather than backfilling every existing row (which would have to
// invent pillar/resourceType from courseType/courseId anyway — exactly what
// this function does, more cheaply and reversibly), old rows are tolerated
// forever at read time and naturally upgrade to the new shape the next time
// the user's own action regenerates their roadmap (retake, /plan). This is
// the same precedent already set for pre-levelSource Roadmap rows elsewhere
// in this feature.
interface LegacyRoadmapItem {
  phase: number;
  courseType: CourseType;
  courseId: string;
  reason: string;
}

export const normalizeRoadmapItem = (raw: unknown): RoadmapItem => {
  const item = raw as LegacyRoadmapItem & Partial<RoadmapItem>;
  if (item.resourceType) return item as RoadmapItem;
  return {
    phase: item.phase,
    pillar: item.courseType,
    resourceType: 'COURSE',
    resourceId: item.courseId,
    reason: item.reason,
  };
};
