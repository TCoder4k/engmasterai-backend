import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CefrLevel, LearningGoal } from '@prisma/client';
import {
  RoadmapAnalysisError,
  RoadmapAnalysisProvider,
  RoadmapAnalysisRequest,
  RoadmapAnalysisResult,
} from './roadmap-analysis.provider';
import { DEFAULT_GEMINI_MODEL_CHAIN, parseGeminiModelList } from '../../shared/gemini-models';
import {
  fetchGeminiWithFallback,
  isGeminiTimeout,
} from '../../shared/gemini-fetch-with-fallback';

// Phase 6 — roadmap narration via the Gemini REST API.
//
// PLAIN `fetch`, NO SDK, matching every other Gemini provider in this
// codebase (see gemini-speech-to-text.provider.ts / gemini-pronunciation-
// feedback.provider.ts): Node 22 has global fetch, this is one POST, and the
// request shape stays visible in the file where the prompt lives.
//
// TEXT ONLY — no inline_data part, unlike the two Shadowing providers. There
// is no audio anywhere in this feature.
//
// TEMPERATURE IS NOT ZERO, for the same reason it is not zero in the
// pronunciation coach: prose that is worded slightly differently between two
// requests is simply prose. It is kept low so the SUBSTANCE (which phases it
// praises, what it recommends focusing on) does not swing between requests.

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The cap on what comes back, in characters.
 *
 * Shorter than pronunciation feedback's 900: this is a one-time orientation
 * paragraph read once at the end of onboarding, not per-attempt coaching a
 * student re-reads after every try.
 */
export const MAX_SUMMARY_CHARS = 700;

// Exported for reuse by gemini-roadmap-planner.provider.ts — one label map
// per enum, not two independently-maintained copies that could drift the
// next time a LearningGoal/CefrLevel value is added.
export const GOAL_LABELS: Record<LearningGoal, string> = {
  FOUNDATION: 'xây nền tảng tiếng Anh từ đầu',
  TOEIC_450: 'đạt 450 điểm TOEIC',
  TOEIC_650: 'đạt 650 điểm TOEIC',
  TOEIC_800: 'đạt 800 điểm TOEIC',
  GENERAL_ENGLISH: 'giỏi tiếng Anh giao tiếp nói chung',
  REGULAR_PRACTICE: 'luyện tập đều đặn để duy trì trình độ',
};

export const LEVEL_LABELS: Record<CefrLevel, string> = {
  A1: 'A1 (mới bắt đầu)',
  A2: 'A2 (sơ cấp)',
  B1: 'B1 (trung cấp)',
  B2: 'B2 (trung cấp cao)',
  C1: 'C1 (nâng cao)',
  C2: 'C2 (thành thạo)',
};

/**
 * Deliberately specific about what NOT to do — same discipline as
 * FEEDBACK_PROMPT in the Shadowing provider, and for the same reason: every
 * negative clause here closes a door a generic "write something nice" prompt
 * would leave open.
 *
 *  - "do not invent, rename or reorder courses" — the plan is finished
 *    before this prompt is built (see roadmap-analysis.provider.ts's header);
 *    this is a second line of defence in the prompt itself, on top of the
 *    result type having no field to smuggle a course id through.
 *  - "do not give a new score or level" — one number already exists for this
 *    attempt (or none, on the beginner-skip path); a second, differently-
 *    worded number invented here is two answers to one question.
 *  - "if section scores are not given, do not guess a level" — the
 *    beginner-skip path has genuinely never been measured; the honest
 *    response to missing data is to talk about the GOAL, not to fabricate a
 *    level from nothing.
 */
const ANALYSIS_PROMPT = [
  'You are a friendly, encouraging English-learning advisor for a Vietnamese student.',
  "You are given the student's goal, an optional estimated CEFR level with section scores, and their finished, ordered learning roadmap (a fixed list of phases, each pointing at one real course).",
  'Write a short, warm orientation paragraph that: (1) acknowledges their goal and current level in one sentence, (2) explains in plain terms WHY this phase order makes sense for them, (3) ends with one encouraging sentence about getting started.',
  'Do not invent, rename or reorder any course or phase — only discuss the ones given to you, in the order given.',
  'Do not give a score, a percentage, a new CEFR level or any numeric rating of any kind — one has already been computed elsewhere.',
  'If no section scores are given, do not guess or imply a level; talk about their goal instead.',
  'Answer in Vietnamese, in plain prose, under 120 words.',
].join(' ');

interface GeminiResponseShape {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

@Injectable()
export class GeminiRoadmapAnalysisProvider implements RoadmapAnalysisProvider {
  private readonly logger = new Logger(GeminiRoadmapAnalysisProvider.name);
  private readonly models: string[];

  constructor(private readonly config: ConfigService) {
    // A chain, not a single model — see env.validation.ts's
    // GEMINI_ENGY_MODEL comment for the 2026-09-04 outage that motivated
    // this. No Joi entry for this key (nothing calls this deprecated
    // endpoint in the live flow — see .env's own comment), so the chain
    // constant IS the live default. Falls through to the next model on
    // 429/503 — see gemini-fetch-with-fallback.ts.
    this.models = parseGeminiModelList(
      this.config.get<string>('GEMINI_ROADMAP_MODEL', DEFAULT_GEMINI_MODEL_CHAIN),
      'GEMINI_ROADMAP_MODEL',
    );
  }

  async generate(
    request: RoadmapAnalysisRequest,
  ): Promise<RoadmapAnalysisResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      // Distinct from UNAVAILABLE: nothing is wrong with the network, the
      // deployment simply has no key. Telling an operator "the service is
      // unavailable" for a missing config value sends them to the wrong place.
      throw new RoadmapAnalysisError(
        'NOT_CONFIGURED',
        'GEMINI_API_KEY is not set; AI roadmap analysis is unavailable',
      );
    }

    const timeoutMs = this.config.get<number>(
      'PLACEMENT_ANALYSIS_TIMEOUT_MS',
      20000,
    );

    let response: Response;
    let model: string;
    try {
      ({ response, model } = await fetchGeminiWithFallback(
        this.models,
        timeoutMs,
        (m) => `${GEMINI_ENDPOINT}/${encodeURIComponent(m)}:generateContent`,
        (_m, signal) => ({
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            // Header, not a query parameter: a key in a URL ends up in access
            // logs, proxy logs and error reports.
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: ANALYSIS_PROMPT },
                  { text: describeRequest(request) },
                ],
              },
            ],
            generationConfig: {
              // Low, not zero — see the file header.
              temperature: 0.4,
              // Generous, not tight (2026-09-05 incident): the 3.x model
              // chain "thinks" before answering, and thinking tokens are
              // billed against this SAME cap — a tight cap can silently
              // truncate mid-sentence well before truncateSummary's own
              // 700-char ceiling ever gets a chance to apply. This is
              // headroom for the reasoning step, not a raised summary-
              // length target.
              maxOutputTokens: 2048,
            },
          }),
        }),
        this.logger,
        'roadmap-analysis',
      ));
    } catch (caught) {
      const aborted = isGeminiTimeout(caught);
      this.logger.warn(
        `Gemini roadmap analysis ${aborted ? 'timed out' : 'failed'} after ${timeoutMs}ms`,
      );
      throw new RoadmapAnalysisError(
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted
          ? 'AI roadmap analysis timed out'
          : 'AI roadmap analysis is unavailable',
      );
    }

    if (!response.ok) {
      this.logger.warn(
        `Gemini roadmap analysis returned HTTP ${response.status}`,
      );
      throw new RoadmapAnalysisError(
        'UNAVAILABLE',
        `AI roadmap analysis failed with status ${response.status}`,
      );
    }

    let payload: GeminiResponseShape;
    try {
      payload = (await response.json()) as GeminiResponseShape;
    } catch {
      throw new RoadmapAnalysisError(
        'UNAVAILABLE',
        'AI roadmap analysis returned no data',
      );
    }

    if (payload.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked the roadmap analysis request: ${payload.promptFeedback.blockReason}`,
      );
      throw new RoadmapAnalysisError(
        'UNAVAILABLE',
        'AI roadmap analysis could not be generated',
      );
    }

    // A summary cut off mid-sentence reads as broken, not as a shorter
    // narrative — reported as UNAVAILABLE so the standard retry copy
    // applies, same as an empty answer below.
    if (payload.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      this.logger.warn('Gemini roadmap analysis was cut off at the token limit');
      throw new RoadmapAnalysisError(
        'UNAVAILABLE',
        'AI roadmap analysis was cut off',
      );
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();

    // AN EMPTY ANSWER IS A FAILURE HERE — a blank paragraph under a button
    // the student just pressed reads as broken, and reported as UNAVAILABLE
    // so the standard retry copy applies.
    if (!text) {
      throw new RoadmapAnalysisError(
        'UNAVAILABLE',
        'AI roadmap analysis returned an empty answer',
      );
    }

    return { summary: truncateSummary(text), model };
  }
}

/** Turns the request into the second half of the prompt. Exported for tests. */
export const describeRequest = (request: RoadmapAnalysisRequest): string => {
  const lines = [
    `Goal: ${GOAL_LABELS[request.goal]}`,
    request.estimatedLevel
      ? `Estimated level: ${LEVEL_LABELS[request.estimatedLevel]}`
      : 'Estimated level: not measured (the student skipped the placement test)',
  ];
  if (request.sectionScores) {
    lines.push(
      `Section scores — Grammar: ${request.sectionScores.grammar}%, Vocabulary: ${request.sectionScores.vocabulary}%, Listening: ${request.sectionScores.listening}%`,
    );
  }
  lines.push('Roadmap phases, in order:');
  request.phases.forEach((phase) => {
    lines.push(
      `${phase.phase}. [${phase.courseType}] ${phase.courseTitle} — ${phase.reason}`,
    );
  });
  return lines.join('\n');
};

/**
 * Bound the stored answer, cutting at a sentence end where there is one.
 *
 * Exported for tests. A hard slice mid-word reads as a bug in the app rather
 * than as a long answer, which is why the last full stop wins when it is not
 * absurdly early — same rule as Shadowing's truncateFeedback.
 */
export const truncateSummary = (raw: string): string => {
  const text = raw.trim();
  if (text.length <= MAX_SUMMARY_CHARS) return text;

  const cut = text.slice(0, MAX_SUMMARY_CHARS);
  const lastStop = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf('\n'),
  );
  if (lastStop > MAX_SUMMARY_CHARS * 0.66) return cut.slice(0, lastStop + 1);
  return `${cut.trimEnd()}…`;
};
