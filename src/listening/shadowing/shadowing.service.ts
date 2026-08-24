import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../../gamification/gamification.service';
import { visibleContentWhere } from '../listening-visibility';
import { normalizeReferenceText } from '../text-normalization';
import { SubmitShadowingAttemptDto } from '../dto';
import { alignRawTranscript } from './transcript-alignment';
import {
  SPEECH_TO_TEXT_PROVIDER,
  SpeechToTextError,
} from './speech-to-text.provider';
// `import type` because the provider is injected by TOKEN, not by class: with
// `emitDecoratorMetadata` a value import here would make TypeScript emit a
// runtime reference to an interface that does not exist at runtime.
import type { SpeechToTextProvider } from './speech-to-text.provider';
import {
  PRONUNCIATION_FEEDBACK_PROVIDER,
  PronunciationFeedbackError,
} from './pronunciation-feedback.provider';
import type { PronunciationFeedbackProvider } from './pronunciation-feedback.provider';
import {
  ListeningShadowingProgressSummaryDto,
  ListeningShadowingSummaryDto,
  ShadowingFeedbackResultDto,
  ShadowingSegmentProgressDto,
  SubmitShadowingAttemptResultDto,
} from '../listening.types';

// Sprint 11 Phase 4B — Shadowing, server-authoritative end to end.
//
// THE ONE SENTENCE: the client uploads audio, and the server decides
// everything else — what was said, how close it was, and whether it passed.
//
// >>> AUDIO LIVES FOR ONE REQUEST AND IS NEVER WRITTEN ANYWHERE <<<
// It arrives as a Buffer in memory (multer memoryStorage, set explicitly in
// the controller), is passed to the provider, and goes out of scope. There is
// no disk path, no Cloudinary call, no S3 client and no `audioUrl` column —
// the absence of a place to put it is the guarantee, not a deletion step that
// could be skipped on an error path. It is also never logged.
//
// WHAT SURVIVES IS THE TRANSCRIPT: text the student can read and dispute. That
// is the minimum needed to explain a score and, deliberately, the maximum kept.

/** Only sentences the student has attempted. Absence IS "not started". */
const SEGMENT_PROGRESS_SELECT = {
  segmentId: true,
  completedAt: true,
  bestAccuracyPercent: true,
  attemptCount: true,
} as const satisfies Prisma.ListeningShadowingSegmentProgressSelect;

/**
 * The largest upload accepted, in bytes.
 *
 * THIS IS THE REAL LIMIT, not the client's `durationMs`. Thirty seconds of
 * Opus is roughly 60–120 KB, so 4 MB is generous enough to absorb a browser
 * that picks a wasteful container (Safari's AAC in MP4 is several times
 * larger) while still bounding what one request can cost in memory and in
 * transcription. Enforced twice on purpose: by multer at parse time, so a
 * hostile upload is cut off at the socket rather than buffered, and here, so
 * the rule survives someone reconfiguring the interceptor.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/**
 * The smallest upload that could contain speech.
 *
 * A container header with no audio in it is around 110 bytes — Phase 3 spent
 * two rounds of debugging on exactly that file. Rejecting it here costs
 * nothing and saves a paid transcription of nothing.
 */
export const MIN_AUDIO_BYTES = 512;

const ACCEPTED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
];

@Injectable()
export class ShadowingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gamification: GamificationService,
    @Inject(SPEECH_TO_TEXT_PROVIDER)
    private readonly speechToText: SpeechToTextProvider,
    // A SECOND, SEPARATE provider — see pronunciation-feedback.provider.ts.
    // This one may be told the target sentence; the one above must never be.
    @Inject(PRONUNCIATION_FEEDBACK_PROVIDER)
    private readonly pronunciationFeedback: PronunciationFeedbackProvider,
  ) {}

  /**
   * The pass mark, from configuration and never hardcoded.
   *
   * >>> PROVISIONAL. 70 is borrowed from `QUIZ_DEFAULT_PASSING_SCORE_PERCENT`
   * because it is this codebase's existing answer to "what counts as good
   * enough", NOT because anyone has measured what a competent learner scores
   * against this engine. Until that measurement exists the number is a guess,
   * which is why every attempt row records the threshold it was judged
   * against — tuning it later must not silently rewrite the meaning of scores
   * already given.
   */
  private passThreshold(): number {
    return this.config.get<number>('SHADOWING_PASSING_ACCURACY_PERCENT', 70);
  }

  /**
   * Submit one shadowing attempt.
   *
   * Order of operations, and none of it is incidental:
   *   1. reject the upload on shape alone — before any work, paid or not;
   *   2. resolve the segment THROUGH the visibility predicate, so a draft
   *      recording 404s on write exactly as it does on read;
   *   3. replay an already-seen `clientAttemptId` BEFORE calling the engine —
   *      this is the step that makes a retry free and deterministic;
   *   4. transcribe;
   *   5. align against the STORED reference;
   *   6. write the attempt and upsert progress in one transaction.
   */
  async submitAttempt(
    userId: string,
    segmentId: string,
    dto: SubmitShadowingAttemptDto,
    audio: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<SubmitShadowingAttemptResultDto> {
    this.assertUsableAudio(audio);

    const segment = await this.prisma.listeningSegment.findFirst({
      where: {
        id: segmentId,
        content: {
          ...visibleContentWhere,
          supportedModes: { has: 'SHADOWING' },
        },
      },
      select: { id: true, contentId: true, text: true, normalizedText: true },
    });

    if (!segment) {
      throw new NotFoundException(
        `Listening segment with ID ${segmentId} not found`,
      );
    }

    const replay = await this.findReplay(userId, dto.clientAttemptId);
    if (replay) return replay;

    const transcript = await this.transcribe(audio!);

    const alignment = alignRawTranscript(segment.normalizedText, transcript);
    const threshold = this.passThreshold();
    // A sentence with no words cannot be passed. `wordsTotal === 0` means the
    // reference normalized to nothing, and 0 >= 0 would otherwise mark it
    // mastered without the student saying anything.
    const passed =
      alignment.wordsTotal > 0 && alignment.accuracyPercent >= threshold;

    const now = new Date();

    const segmentRow = await this.prisma.$transaction(async (tx) => {
      await tx.listeningShadowingAttempt.create({
        data: {
          userId,
          segmentId: segment.id,
          // From the SEGMENT, never from the request — a contentId in a body
          // would let a caller file an attempt against a recording they never
          // opened.
          contentId: segment.contentId,
          rawTranscript: transcript,
          normalizedTranscript: alignment.normalizedTranscript,
          transcriptSource: this.speechToText.source,
          referenceTextSnapshot: segment.text,
          accuracyPercent: alignment.accuracyPercent,
          wordsCorrect: alignment.wordsCorrect,
          wordsTotal: alignment.wordsTotal,
          substitutions: alignment.substitutions,
          insertions: alignment.insertions,
          deletions: alignment.deletions,
          passed,
          passThresholdPercent: threshold,
          durationMs: dto.durationMs ?? null,
          clientAttemptId: dto.clientAttemptId,
        },
      });

      const previous = await tx.listeningShadowingSegmentProgress.findUnique({
        where: { userId_segmentId: { userId, segmentId: segment.id } },
        select: { bestAccuracyPercent: true, completedAt: true },
      });

      const progress = await tx.listeningShadowingSegmentProgress.upsert({
        where: { userId_segmentId: { userId, segmentId: segment.id } },
        create: {
          userId,
          segmentId: segment.id,
          contentId: segment.contentId,
          completedAt: passed ? now : null,
          bestAccuracyPercent: alignment.accuracyPercent,
          attemptCount: 1,
          lastAttemptAt: now,
        },
        update: {
          // Set once, never cleared. A worse later attempt does not un-pass a
          // sentence — the same contract as LessonStepProgress.completedAt.
          completedAt: previous?.completedAt ?? (passed ? now : null),
          // Monotonic. Practising again can only raise this.
          bestAccuracyPercent: Math.max(
            previous?.bestAccuracyPercent ?? 0,
            alignment.accuracyPercent,
          ),
          attemptCount: { increment: 1 },
          lastAttemptAt: now,
        },
        select: SEGMENT_PROGRESS_SELECT,
      });

      // A submitted attempt is a qualifying activity day, same as a quiz
      // submission — see activity-window.ts. No XP award: this only feeds
      // the streak; awarding XP for listening is a separate product call
      // nobody has made yet.
      await this.gamification.recordProgress(tx, userId, {
        at: now,
        awards: [],
        countsAsActivity: true,
      });

      return progress;
    });

    return {
      transcript,
      normalizedTranscript: alignment.normalizedTranscript,
      alignment: alignment.tokens,
      accuracyPercent: alignment.accuracyPercent,
      wordsCorrect: alignment.wordsCorrect,
      wordsTotal: alignment.wordsTotal,
      substitutions: alignment.substitutions,
      insertions: alignment.insertions,
      deletions: alignment.deletions,
      passed,
      passThresholdPercent: threshold,
      segment: segmentRow,
    };
  }

  /**
   * Sprint 11 Phase 4C — AI coaching on an attempt that has already been graded.
   *
   * >>> THIS CHANGES NO SCORE, EVER. <<<
   * It writes three nullable columns on an existing attempt row and touches
   * neither the verdict, the progress row, nor XP. A feedback failure is
   * therefore harmless: the student keeps the result they already earned, which
   * is why the copy says so and why this does not run inside a transaction with
   * anything.
   *
   * Order of operations:
   *   1. reject the upload on shape alone — before any work, paid or not;
   *   2. resolve the attempt BY THIS USER's idempotency key, so the reference
   *      sentence and transcript come from the server's own row rather than
   *      from the request;
   *   3. return stored feedback if it exists — BEFORE calling the engine, for
   *      the same two reasons the attempt replay does: it costs money, and a
   *      second opinion that disagrees with the first is worse than none;
   *   4. generate, then persist.
   */
  async requestFeedback(
    userId: string,
    segmentId: string,
    clientAttemptId: string,
    audio: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<ShadowingFeedbackResultDto> {
    this.assertUsableAudio(audio);

    const attempt = await this.prisma.listeningShadowingAttempt.findUnique({
      where: { userId_clientAttemptId: { userId, clientAttemptId } },
      select: {
        id: true,
        segmentId: true,
        rawTranscript: true,
        referenceTextSnapshot: true,
        aiFeedback: true,
        aiFeedbackAt: true,
        aiFeedbackModel: true,
      },
    });

    // Scoped by userId, so this can only ever be one of the caller's own rows —
    // there is no id here to probe with. A mismatched segment is the same 404:
    // a body and a route that disagree describe an attempt that does not exist.
    if (!attempt || attempt.segmentId !== segmentId) {
      throw new NotFoundException(
        `Shadowing attempt ${clientAttemptId} not found`,
      );
    }

    if (attempt.aiFeedback && attempt.aiFeedbackAt) {
      return {
        feedback: attempt.aiFeedback,
        generatedAt: attempt.aiFeedbackAt,
        model: attempt.aiFeedbackModel ?? this.pronunciationFeedback.model,
        cached: true,
      };
    }

    const generated = await this.generateFeedback({
      audio: audio!,
      // BOTH from the stored row. The reference is the snapshot taken when the
      // attempt was graded, not the live sentence, so coaching cannot end up
      // discussing a sentence an admin edited afterwards.
      referenceText: attempt.referenceTextSnapshot,
      transcript: attempt.rawTranscript,
    });

    const model = this.pronunciationFeedback.model;
    const now = new Date();

    // A plain update, no transaction: this row already exists and nothing else
    // changes with it. Losing the write after a successful call costs one
    // repeated request, which is the cheapest failure in this file.
    await this.prisma.listeningShadowingAttempt.update({
      where: { id: attempt.id },
      data: {
        aiFeedback: generated,
        aiFeedbackAt: now,
        aiFeedbackModel: model,
      },
    });

    return { feedback: generated, generatedAt: now, model, cached: false };
  }

  /**
   * Per-sentence shadowing progress for one recording. Read-only.
   *
   * Absence of a row is "not started" — there is no placeholder row and no
   * `POST start`, matching Dictation. A student is started when they have
   * spoken, not when they pressed something.
   */
  async findContentProgress(
    userId: string,
    contentId: string,
  ): Promise<ShadowingSegmentProgressDto[]> {
    return this.prisma.listeningShadowingSegmentProgress.findMany({
      where: { userId, contentId },
      select: SEGMENT_PROGRESS_SELECT,
    });
  }

  /**
   * The catalog's batch read for Shadowing — the exact counterpart of
   * DictationService.findProgressSummaries, kept as a SEPARATE method rather
   * than a shared one for the same reason the two progress tables are
   * separate models (see ListeningDictationSegmentProgress's doc comment):
   * `assisted` has no Shadowing equivalent, and a generalised query would
   * either grow a branch for a field only one mode has or fit neither mode
   * cleanly.
   *
   * THREE QUERIES, INDEPENDENT OF THE NUMBER OF IDS — same shape as
   * Dictation's: one to resolve which ids are visible and how many segments
   * each has, two `groupBy`s (completed count, latest activity) run in
   * parallel. Ids the student cannot see are simply absent from the result.
   */
  async findProgressSummaries(
    userId: string,
    contentIds: string[],
  ): Promise<ListeningShadowingProgressSummaryDto[]> {
    if (contentIds.length === 0) return [];

    const contents = await this.prisma.listeningContent.findMany({
      where: { id: { in: contentIds }, ...visibleContentWhere },
      select: {
        id: true,
        supportedModes: true,
        _count: { select: { segments: true } },
      },
    });

    if (contents.length === 0) return [];
    const visibleIds = contents.map((content) => content.id);

    const [completedGroups, activity] = await Promise.all([
      this.prisma.listeningShadowingSegmentProgress.groupBy({
        by: ['contentId'],
        where: {
          userId,
          contentId: { in: visibleIds },
          completedAt: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.listeningShadowingSegmentProgress.groupBy({
        by: ['contentId'],
        where: { userId, contentId: { in: visibleIds } },
        _max: { lastAttemptAt: true },
      }),
    ]);

    const completedByContent = new Map(
      completedGroups.map((row) => [row.contentId, row._count._all]),
    );
    const activityByContent = new Map(
      activity.map((row) => [row.contentId, row._max.lastAttemptAt]),
    );

    return contents.map((content) => ({
      contentId: content.id,
      shadowing: content.supportedModes.includes('SHADOWING')
        ? summariseShadowing(
            content._count.segments,
            completedByContent.get(content.id) ?? 0,
            activityByContent.get(content.id) ?? null,
          )
        : null,
    }));
  }

  /**
   * Reject an upload that cannot possibly be gradeable, before any work.
   *
   * Deliberately BEFORE the segment lookup and the idempotency check: these
   * are pure shape tests, and a malformed request should not reach the
   * database at all, let alone the paid engine.
   */
  private assertUsableAudio(
    audio: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): void {
    if (!audio || audio.size === 0) {
      throw new BadRequestException('No audio was uploaded');
    }
    if (audio.size < MIN_AUDIO_BYTES) {
      // The Phase 3 failure exactly: a container header with no audio in it.
      throw new BadRequestException('The recording contains no audio');
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new BadRequestException('The recording is too large');
    }
    // Compared on the type alone: browsers append codec parameters
    // (`audio/webm;codecs=opus`) that vary by engine and must not decide
    // whether a valid recording is accepted.
    const baseType = audio.mimetype.split(';')[0].trim().toLowerCase();
    if (!ACCEPTED_AUDIO_TYPES.includes(baseType)) {
      throw new BadRequestException(`Unsupported audio format: ${baseType}`);
    }
  }

  /**
   * Return the ORIGINAL outcome for a `clientAttemptId` already seen.
   *
   * Not a re-grade. The reference sentence may have been edited since, and the
   * engine is non-deterministic across versions — re-running either would hand
   * one attempt two different verdicts. This is also what makes a client
   * retrying after a timeout free rather than a second charge.
   */
  private async findReplay(
    userId: string,
    clientAttemptId: string,
  ): Promise<SubmitShadowingAttemptResultDto | null> {
    const existing = await this.prisma.listeningShadowingAttempt.findUnique({
      where: { userId_clientAttemptId: { userId, clientAttemptId } },
      select: {
        segmentId: true,
        rawTranscript: true,
        normalizedTranscript: true,
        referenceTextSnapshot: true,
        accuracyPercent: true,
        wordsCorrect: true,
        wordsTotal: true,
        substitutions: true,
        insertions: true,
        deletions: true,
        passed: true,
        passThresholdPercent: true,
      },
    });
    if (!existing) return null;

    const segmentRow =
      await this.prisma.listeningShadowingSegmentProgress.findUnique({
        where: { userId_segmentId: { userId, segmentId: existing.segmentId } },
        select: SEGMENT_PROGRESS_SELECT,
      });

    // The alignment is recomputed from the two STORED normalized texts rather
    // than persisted as JSON. It is a pure function of them, so it cannot
    // drift, and a token array in a column is a schema that has to be migrated
    // every time the display changes. `referenceTextSnapshot` is normalized
    // here so a later edit to the live sentence cannot alter an old replay.
    const replayAlignment = alignRawTranscript(
      // The snapshot is raw sentence text, so it needs the same treatment
      // `ListeningSegment.normalizedText` received at write time.
      normalizeReferenceText(existing.referenceTextSnapshot),
      existing.normalizedTranscript,
    );

    return {
      transcript: existing.rawTranscript,
      normalizedTranscript: existing.normalizedTranscript,
      alignment: replayAlignment.tokens,
      accuracyPercent: existing.accuracyPercent,
      wordsCorrect: existing.wordsCorrect,
      wordsTotal: existing.wordsTotal,
      substitutions: existing.substitutions,
      insertions: existing.insertions,
      deletions: existing.deletions,
      passed: existing.passed,
      passThresholdPercent: existing.passThresholdPercent,
      segment: segmentRow ?? {
        segmentId: existing.segmentId,
        completedAt: null,
        bestAccuracyPercent: null,
        attemptCount: 0,
      },
    };
  }

  /**
   * Call the engine, and turn its failures into HTTP the client can act on.
   *
   * `NOT_CONFIGURED` is deliberately the same 503 as an outage FROM THE
   * STUDENT'S SIDE — they can do nothing about either — while the log line and
   * the exception kind keep them distinct for whoever has to fix it.
   */
  private async transcribe(audio: {
    buffer: Buffer;
    mimetype: string;
  }): Promise<string> {
    try {
      const result = await this.speechToText.transcribe({
        audio: audio.buffer,
        mimeType: audio.mimetype,
        languageCode: 'en-US',
      });
      return result.transcript;
    } catch (caught) {
      if (caught instanceof SpeechToTextError) {
        if (caught.kind === 'UNSUPPORTED_AUDIO') {
          throw new BadRequestException(
            'The recording could not be processed. Please record again.',
          );
        }
        throw new ServiceUnavailableException(
          caught.kind === 'TIMEOUT'
            ? 'Speech recognition timed out. Please try again.'
            : 'Speech recognition is unavailable. Please try again shortly.',
        );
      }
      throw caught;
    }
  }

  /**
   * Call the coaching engine, mapping its failures the same way.
   *
   * Separate from `transcribe` rather than generalised with it: the two take
   * different inputs (this one is given the reference sentence, that one must
   * never be), and a shared helper would be the seam through which the
   * reference eventually reaches the grader.
   */
  private async generateFeedback(input: {
    audio: { buffer: Buffer; mimetype: string };
    referenceText: string;
    transcript: string;
  }): Promise<string> {
    try {
      const result = await this.pronunciationFeedback.generate({
        audio: input.audio.buffer,
        mimeType: input.audio.mimetype,
        referenceText: input.referenceText,
        transcript: input.transcript,
        languageCode: 'en-US',
      });
      return result.feedback;
    } catch (caught) {
      if (caught instanceof PronunciationFeedbackError) {
        if (caught.kind === 'UNSUPPORTED_AUDIO') {
          throw new BadRequestException(
            'The recording could not be processed. Please record again.',
          );
        }
        throw new ServiceUnavailableException(
          caught.kind === 'TIMEOUT'
            ? 'AI feedback timed out. Please try again.'
            : 'AI feedback is unavailable. Please try again shortly.',
        );
      }
      throw caught;
    }
  }
}

/**
 * The completion rule, in one place — line-comparable with dictation.service's
 * `summarise`. `totalSegments > 0` is load-bearing: a recording with no
 * sentences is empty, not complete, and `0 === 0` would otherwise report a
 * student as having finished work that never existed.
 */
const summariseShadowing = (
  totalSegments: number,
  completedSegments: number,
  lastActivityAt: Date | null,
): ListeningShadowingSummaryDto => ({
  totalSegments,
  completedSegments,
  completed: totalSegments > 0 && completedSegments === totalSegments,
  lastActivityAt,
});
