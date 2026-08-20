import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { visibleExerciseWhere } from './speaking-visibility';
import { SpeakingSessionStore } from './speaking-session.store';
import { SpeakingLiveTicketStore } from './live/speaking-live-ticket.store';
import {
  SpeakingAiExerciseContext,
  SpeakingAttemptSummaryDto,
  StartSpeakingAttemptResultDto,
} from './speaking.types';

// Speaking Partner — the attempt lifecycle (start/complete). The actual
// conversation is now Gemini Live, relayed by SpeakingLiveGateway/
// SpeakingLiveSession (see src/speaking/live/) — this service only owns the
// two Postgres/Redis lifecycle moments that live outside that WebSocket:
// creating the attempt row and closing it out.
//
// submitTurn() — the old STT→text-reply orchestration — is RETIRED along
// with SPEAKING_SPEECH_TO_TEXT_PROVIDER/SPEAKING_AI_PROVIDER and
// SpeakingIdempotencyStore. A Live session generates transcript+reply
// directly and finalizes each turn itself (SpeakingLiveSession); this
// service never sees individual turns.

const EXERCISE_AI_CONTEXT_SELECT = {
  aiRole: true,
  level: true,
  description: true,
  openingLine: true,
  conversationGoal: true,
} as const;

@Injectable()
export class SpeakingAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionStore: SpeakingSessionStore,
    private readonly liveTicketStore: SpeakingLiveTicketStore,
  ) {}

  /**
   * Start a new attempt for an exercise. No Gemini call — the opening line
   * is authored content, read straight off the exercise row. Also issues
   * the one-shot ticket the frontend needs to open the Speaking Live
   * WebSocket for this attempt (see speaking-live-ticket.store.ts).
   */
  async start(userId: string, exerciseId: string): Promise<StartSpeakingAttemptResultDto> {
    const exercise = await this.prisma.speakingExercise.findFirst({
      where: { id: exerciseId, ...visibleExerciseWhere },
      select: {
        id: true,
        title: true,
        titleVi: true,
        level: true,
        description: true,
        descriptionVi: true,
        openingLine: true,
      },
    });

    if (!exercise) {
      throw new NotFoundException(`Speaking exercise with ID ${exerciseId} not found`);
    }

    const attempt = await this.prisma.speakingAttempt.create({
      data: { userId, exerciseId: exercise.id },
      select: { id: true, startedAt: true },
    });

    const liveTicket = await this.liveTicketStore.issue(userId, attempt.id);

    return {
      attemptId: attempt.id,
      exerciseId: exercise.id,
      startedAt: attempt.startedAt.toISOString(),
      openingLine: exercise.openingLine,
      exercise: {
        title: exercise.title,
        titleVi: exercise.titleVi,
        level: exercise.level,
        description: exercise.description,
        descriptionVi: exercise.descriptionVi,
      },
      liveTicket,
    };
  }

  /**
   * Resolves a consumed Live ticket's {userId, attemptId} into the exercise
   * persona SpeakingLiveGateway needs to open a Gemini Live session — the
   * SAME re-check-scoped-to-this-user, re-check-visibility discipline
   * submitTurn() used to apply on every turn, now applied once at connect
   * time (a Live connection is one long-lived conversation, not a series
   * of independent requests to re-check). Null means "reject the
   * connection" — the gateway has no other way to surface this over a raw
   * WS handshake.
   */
  async loadLiveContext(userId: string, attemptId: string): Promise<SpeakingAiExerciseContext | null> {
    const attempt = await this.prisma.speakingAttempt.findFirst({
      where: { id: attemptId, userId, exercise: visibleExerciseWhere },
      select: { completedAt: true, exercise: { select: EXERCISE_AI_CONTEXT_SELECT } },
    });
    if (!attempt || attempt.completedAt) return null;
    return attempt.exercise;
  }

  /**
   * Complete an attempt — the ONLY place SpeakingAttempt is written after
   * start(). Idempotent: a second call on an already-completed attempt
   * returns the same stored values rather than erroring or recomputing.
   *
   * turnCount is DERIVED HERE, from the live Redis session (now written by
   * SpeakingLiveSession's finalizeTurn() instead of the old submitTurn()),
   * and persisted exactly once. If the Redis session has already expired
   * (SPEAKING_SESSION_TTL_SECONDS), this reports 0 — an accepted,
   * documented limitation, the same class of tradeoff ChatSessionStore
   * already accepts for its own bounded history.
   */
  async complete(userId: string, attemptId: string): Promise<SpeakingAttemptSummaryDto> {
    const attempt = await this.prisma.speakingAttempt.findFirst({
      where: { id: attemptId, userId },
      select: { id: true, exerciseId: true, startedAt: true, completedAt: true, turnCount: true },
    });

    if (!attempt) {
      throw new NotFoundException(`Speaking attempt with ID ${attemptId} not found`);
    }

    if (attempt.completedAt) {
      return {
        attemptId: attempt.id,
        exerciseId: attempt.exerciseId,
        startedAt: attempt.startedAt.toISOString(),
        completedAt: attempt.completedAt.toISOString(),
        turnCount: attempt.turnCount,
      };
    }

    const turns = await this.sessionStore.getTurns(userId, attemptId);
    const turnCount = turns.filter((turn) => turn.role === 'user').length;
    const now = new Date();

    const updated = await this.prisma.speakingAttempt.update({
      where: { id: attempt.id },
      data: { completedAt: now, turnCount },
      select: { id: true, exerciseId: true, startedAt: true, completedAt: true, turnCount: true },
    });

    // The conversation is over — nothing needs the session key to survive
    // past this point; clearing it is cheap hygiene rather than waiting out
    // the TTL.
    await this.sessionStore.clear(userId, attemptId);

    return {
      attemptId: updated.id,
      exerciseId: updated.exerciseId,
      startedAt: updated.startedAt.toISOString(),
      completedAt: updated.completedAt!.toISOString(),
      turnCount: updated.turnCount,
    };
  }
}
