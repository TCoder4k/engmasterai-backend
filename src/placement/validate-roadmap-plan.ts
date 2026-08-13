import { RoadmapResourceCandidate, RoadmapItem } from './roadmap-algorithm';
import { RoadmapPlanningResult } from './roadmap/roadmap-planner.provider';

// Pure function, no I/O — the strict server-side validation step between
// "the AI planner answered" and "we persist it" (PlacementService.
// requestRoadmapPlan). This is where the hybrid architecture's core
// guarantee actually lives: AI selects, this function is the only thing
// that decides whether that selection is trustworthy enough to become the
// student's real roadmap.
//
// REJECTS THE WHOLE PLAN, NEVER PARTIALLY APPLIES IT. A model that got one
// phase wrong (a disallowed id, a duplicate, a dropped pillar) has an
// unreliable answer, not an almost-right one — partially applying it would
// silently produce a roadmap that is neither the AI's real intent nor the
// deterministic fallback. The caller (requestRoadmapPlan) already has a
// correct deterministic roadmap persisted before this is ever called, so
// "reject everything, keep what's already there" costs nothing.
//
// `phase`, `pillar`, and `resourceType` are NEVER read from `result` as
// given — `phase` is the validated array's own 1-indexed position, `pillar`
// and `resourceType` come from the matched candidate (re-asserted, not
// copied from the model's own `resourceType` field, which is why the
// allow-list key is checked as `resourceType:resourceId` together rather
// than by id alone — a model that names a real id but the wrong
// resourceType for it is caught here, not silently trusted). Nothing from
// the model reaches RoadmapItem except `reason` (already length-bounded by
// the provider) and the resource identity (already checked against the
// allow-list).
export const MAX_PLAN_PHASES = 5;

export interface ValidatedRoadmapPlan {
  items: RoadmapItem[];
  overallReason: string;
}

export const validateRoadmapPlan = (
  result: RoadmapPlanningResult,
  candidates: RoadmapResourceCandidate[],
): ValidatedRoadmapPlan | null => {
  if (result.phases.length === 0 || result.phases.length > MAX_PLAN_PHASES) {
    return null;
  }

  const byKey = new Map(candidates.map((c) => [`${c.resourceType}:${c.id}`, c]));
  const seen = new Set<string>();
  const items: RoadmapItem[] = [];

  for (const phase of result.phases) {
    const key = `${phase.resourceType}:${phase.resourceId}`;
    const candidate = byKey.get(key);
    if (!candidate) return null; // outside the allow-list -> reject the whole plan
    if (seen.has(key)) return null; // duplicate -> reject the whole plan
    seen.add(key);
    items.push({
      phase: items.length + 1,
      pillar: candidate.pillar,
      resourceType: candidate.resourceType,
      resourceId: candidate.id,
      reason: phase.reason,
    });
  }

  // Pillar-coverage guarantee: if a real, goal-eligible candidate exists for
  // a pillar, the AI is not permitted to silently drop that pillar from the
  // plan. Without this, a model could turn a genuine 3-pillar roadmap into a
  // 1- or 2-pillar one simply by omitting a phase it had a valid resource
  // for — the allow-list check above would still pass, since it only checks
  // that what WAS returned is valid, not that nothing eligible was left out.
  const availablePillars = new Set(candidates.map((c) => c.pillar));
  const coveredPillars = new Set(items.map((i) => i.pillar));
  for (const pillar of availablePillars) {
    if (!coveredPillars.has(pillar)) return null;
  }

  return { items, overallReason: result.overallReason };
};
