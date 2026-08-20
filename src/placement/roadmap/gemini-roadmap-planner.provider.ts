import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GOAL_LABELS, LEVEL_LABELS } from './gemini-roadmap-analysis.provider';
import {
  RoadmapPlanningError,
  RoadmapPlannerProvider,
  RoadmapPlanningPhase,
  RoadmapPlanningRequest,
  RoadmapPlanningResult,
} from './roadmap-planner.provider';

// POST /placement/roadmap/plan — multi-pillar resource SELECTION via the
// Gemini REST API, constrained to a closed candidate set (see
// roadmap-planner.provider.ts's header for the structural guarantee against
// inventing a resource).
//
// PLAIN `fetch`, NO SDK, matching every other Gemini provider in this
// codebase.
//
// STRUCTURED OUTPUT + TEMPERATURE 0, same reasoning as
// gemini-speech-to-text.provider.ts: this is a "pick the right answer from a
// closed list" task, not a prose-variation task like the (now deprecated)
// narration provider's — the same candidate list should not produce a
// different selection on a retry. `overallReason` rides in the SAME
// temperature:0 call as `phases` — per-phase reasons already prove short
// prose works fine at temperature 0, so this is not a new experiment.

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The cap on each phase's `reason`, in characters. Short — this is a
 * one-line "why this resource" tag rendered next to a phase, not the whole-
 * plan rationale (MAX_OVERALL_REASON_CHARS) or the old narration provider's
 * 700-char orientation paragraph.
 */
export const MAX_REASON_CHARS = 200;

/**
 * The cap on `overallReason`, in characters. A one-to-two-sentence summary
 * of the whole plan's prioritization — longer than a per-phase reason,
 * shorter than the deprecated narration provider's full paragraph.
 */
export const MAX_OVERALL_REASON_CHARS = 300;

/**
 * Deliberately specific about what NOT to do — extended to cover
 * deck/word/recording counts alongside courses/durations/lesson counts: this
 * feature hands the model a full candidate list (title, level, description)
 * across three different resource types, and a model given that much
 * metadata is exactly the kind of model that could plausibly invent a count
 * or duration that sounds plausible but was never given to it.
 */
const PLANNING_PROMPT = [
  'You are an English-learning curriculum planner for a Vietnamese student.',
  "You are given the student's goal, an estimated CEFR level, optional section scores, and a CLOSED list of real resource candidates grouped by pillar (Grammar/Vocabulary/Listening, and sometimes a fourth pillar, Speaking). Each candidate has a resourceType: COURSE (Grammar), VOCAB_LIBRARY (Vocabulary), LISTENING_CATEGORY (Listening), or SPEAKING_SCENARIO (Speaking).",
  'Select exactly ONE resource per pillar that has at least one candidate, choosing whichever candidate in that pillar best fits the given level and goal.',
  'If section scores are given, order the Grammar/Vocabulary/Listening phases weakest-pillar-first. If no section scores are given, keep those three in the order Grammar, then Vocabulary, then Listening. The Speaking pillar has no section score and is never placement-tested — if a Speaking candidate is given, its phase must always be placed LAST, after every other phase, regardless of section scores.',
  'Return resourceType and resourceId values ONLY from the candidate list given in this request — never invent, rename, or reference any resource, id, pillar, or resourceType that was not explicitly listed.',
  'For each phase, write one short, encouraging reason (under 30 words) explaining why that resource fits this student. For the Speaking phase, describe it as natural conversation practice with an AI partner — never state or imply a score, percentage, or CEFR level for it, since it is never tested.',
  "Also write one overallReason: 2-3 short sentences (under 40 words total) summarizing why the whole plan is prioritized this way across all phases, written directly to the student (\"bạn\") so it reads like personal advice, not a generic label. Wrap the 1-2 most important keywords or phrases (e.g. the student's weakest skill, or the pillar they should focus on first) in double asterisks for bold emphasis, like **kỹ năng nghe yếu nhất** — plain Markdown bold syntax, nothing else (no headings, lists, or other Markdown).",
  'Do not state or imply any score, percentage, CEFR level, duration, lesson count, deck count, word count, or recording count that was not explicitly given to you in this request.',
  'Answer in Vietnamese.',
].join(' ');

interface GeminiResponseShape {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

interface RawPlanShape {
  phases?: { resourceType?: unknown; resourceId?: unknown; reason?: unknown }[];
  overallReason?: unknown;
}

@Injectable()
export class GeminiRoadmapPlannerProvider implements RoadmapPlannerProvider {
  private readonly logger = new Logger(GeminiRoadmapPlannerProvider.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>(
      'GEMINI_ROADMAP_PLANNER_MODEL',
      'gemini-2.5-flash',
    );
  }

  async plan(request: RoadmapPlanningRequest): Promise<RoadmapPlanningResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new RoadmapPlanningError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; AI roadmap planning is unavailable',
      );
    }

    const model = this.model;
    const timeoutMs = this.config.get<number>(
      'PLACEMENT_PLANNING_TIMEOUT_MS',
      20000,
    );

    // A bounded wait, always — see gemini-roadmap-analysis.provider.ts's
    // identical comment.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(
        `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: PLANNING_PROMPT },
                  { text: describeRequest(request) },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  phases: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        resourceType: { type: 'STRING' },
                        resourceId: { type: 'STRING' },
                        reason: { type: 'STRING' },
                      },
                      required: ['resourceType', 'resourceId', 'reason'],
                    },
                  },
                  overallReason: { type: 'STRING' },
                },
                required: ['phases', 'overallReason'],
              },
            },
          }),
        },
      );
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      this.logger.warn(
        `Gemini roadmap planning ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms`,
      );
      throw new RoadmapPlanningError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted
          ? 'AI roadmap planning timed out'
          : 'AI roadmap planning is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.warn(
        `Gemini roadmap planning returned HTTP ${response.status}`,
      );
      throw new RoadmapPlanningError(
        'UNAVAILABLE',
        `AI roadmap planning failed with status ${response.status}`,
      );
    }

    let payload: GeminiResponseShape;
    try {
      payload = (await response.json()) as GeminiResponseShape;
    } catch {
      throw new RoadmapPlanningError(
        'UNAVAILABLE',
        'AI roadmap planning returned no data',
      );
    }

    if (payload.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked the roadmap planning request: ${payload.promptFeedback.blockReason}`,
      );
      throw new RoadmapPlanningError(
        'UNAVAILABLE',
        'AI roadmap planning could not be generated',
      );
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new RoadmapPlanningError(
        'UNAVAILABLE',
        'AI roadmap planning returned an empty answer',
      );
    }

    return extractPlan(text);
  }
}

/** Turns the request into the second half of the prompt. Exported for tests. */
export const describeRequest = (request: RoadmapPlanningRequest): string => {
  const lines = [
    `Goal: ${GOAL_LABELS[request.goal]}`,
    `Estimated level: ${LEVEL_LABELS[request.estimatedLevel]}${
      request.levelSource === 'BEGINNER_ASSUMED'
        ? ' (assumed baseline — the student skipped the placement test, this is not a measured level)'
        : ''
    }`,
  ];
  if (request.sectionScores) {
    lines.push(
      `Section scores — Grammar: ${request.sectionScores.grammar}%, Vocabulary: ${request.sectionScores.vocabulary}%, Listening: ${request.sectionScores.listening}%`,
    );
  }
  lines.push('Candidates, grouped by pillar:');
  const byPillar = new Map<string, typeof request.candidates>();
  for (const candidate of request.candidates) {
    const list = byPillar.get(candidate.pillar) ?? [];
    list.push(candidate);
    byPillar.set(candidate.pillar, list);
  }
  for (const [pillar, candidates] of byPillar) {
    lines.push(`${pillar}:`);
    candidates.forEach((c) => {
      lines.push(
        `- resourceType: ${c.resourceType} | id: ${c.id} | title: ${c.title} | level: ${c.level ?? 'unset'} | description: ${c.description}`,
      );
    });
  }
  return lines.join('\n');
};

/**
 * Structural parsing/normalization ONLY — is this valid JSON shaped like
 * `{ phases: [{resourceType, resourceId, reason}], overallReason }`?
 * Business-rule validation (are these resourceType/resourceId pairs
 * actually in the candidate set given, are there duplicates, is the count
 * sane) is deliberately NOT this function's job — that happens in
 * validate-roadmap-plan.ts, which is the layer that knows the allow-list.
 * `resourceType` is only checked to be a string here, not one of the three
 * known literals — an unrecognized value simply won't match any allow-list
 * key downstream and fails closed by construction. A model that ignored the
 * schema and answered in prose, or omitted `overallReason` entirely, is
 * treated as a failure (UNAVAILABLE), not tolerated with a partial result —
 * unlike a transcript, there is no meaningful "raw text fallback" for a
 * structured plan.
 *
 * Exported for tests.
 */
export const extractPlan = (raw: string): RoadmapPlanningResult => {
  let parsed: RawPlanShape;
  try {
    parsed = JSON.parse(raw) as RawPlanShape;
  } catch {
    throw new RoadmapPlanningError(
      'UNAVAILABLE',
      'AI roadmap planning returned unparseable output',
    );
  }
  if (!Array.isArray(parsed.phases)) {
    throw new RoadmapPlanningError(
      'UNAVAILABLE',
      'AI roadmap planning returned no phases',
    );
  }
  if (typeof parsed.overallReason !== 'string') {
    throw new RoadmapPlanningError(
      'UNAVAILABLE',
      'AI roadmap planning returned no overall reason',
    );
  }

  const phases = parsed.phases
    .filter(
      (p): p is { resourceType: string; resourceId: string; reason: string } =>
        typeof p.resourceType === 'string' &&
        typeof p.resourceId === 'string' &&
        typeof p.reason === 'string',
    )
    .map((p) => ({
      resourceType: p.resourceType as RoadmapPlanningPhase['resourceType'],
      resourceId: p.resourceId,
      reason: truncateReason(p.reason),
    }));

  return { phases, overallReason: truncateOverallReason(parsed.overallReason) };
};

/**
 * Bound text, cutting at a sentence end where there is one — same rule as
 * gemini-roadmap-analysis.provider.ts's truncateSummary, parameterized by
 * cap so per-phase reasons and the overall reason share one implementation.
 */
const truncateAt = (raw: string, maxChars: number): string => {
  const text = raw.trim();
  if (text.length <= maxChars) return text;

  const cut = text.slice(0, maxChars);
  const lastStop = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  if (lastStop > maxChars * 0.5) return cut.slice(0, lastStop + 1);
  return `${cut.trimEnd()}…`;
};

/** Exported for tests. */
export const truncateReason = (raw: string): string =>
  truncateAt(raw, MAX_REASON_CHARS);

/** Exported for tests. */
export const truncateOverallReason = (raw: string): string =>
  truncateAt(raw, MAX_OVERALL_REASON_CHARS);
