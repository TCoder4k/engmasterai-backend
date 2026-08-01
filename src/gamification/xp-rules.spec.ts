import { LessonStepKind, LessonTaskType, XpSource } from '@prisma/client';
import {
  achievementAward,
  isQuizPassKey,
  stageAward,
  taskPassedAward,
  trapClearedAward,
  wordMasteredAward,
  wordReviewedAward,
  XP_AWARDS,
} from './xp-rules';

// THESE ASSERTIONS USE LITERAL STRINGS ON PURPOSE.
//
// sourceKey is half of XpTransaction's @@unique([userId, sourceKey]), which is
// what makes an award exactly-once at the database level. If the format of an
// EXISTING key ever changes after deploy, every past award stops matching its
// new key and every student is silently paid a second time for work they
// already did — no exception, no log line, nothing to notice.
//
// Building the expected string from the same helper would test nothing. The
// literal is the contract.

describe('XP amounts', () => {
  it('matches the product-owner table set on 2026-07-31', () => {
    expect(XP_AWARDS).toEqual({
      VIDEO_STAGE_COMPLETED: 10,
      THEORY_STAGE_COMPLETED: 10,
      QUIZ_PASSED: 30,
      PRACTICE_PASSED: 40,
      TRAP_CLEARED: 5,
      WORD_REVIEWED: 1,
      WORD_MASTERED: 15,
    });
  });

  it('never awards a non-positive amount', () => {
    // A zero award would write a ledger row that changes nothing; a negative
    // one is a refund, which Sprint 10 has no concept of.
    for (const amount of Object.values(XP_AWARDS)) {
      expect(amount).toBeGreaterThan(0);
    }
  });
});

describe('stageAward', () => {
  it('keys video by lesson and step', () => {
    expect(stageAward('lesson-1', LessonStepKind.VIDEO)).toEqual({
      source: XpSource.STAGE_COMPLETED,
      sourceKey: 'step:lesson-1:VIDEO',
      amount: 10,
    });
  });

  it('keys theory separately from video on the same lesson', () => {
    // Both stages of one lesson must be independently payable, so the step
    // has to be part of the key.
    expect(stageAward('lesson-1', LessonStepKind.THEORY)).toEqual({
      source: XpSource.STAGE_COMPLETED,
      sourceKey: 'step:lesson-1:THEORY',
      amount: 10,
    });
    expect(stageAward('lesson-1', LessonStepKind.VIDEO).sourceKey).not.toBe(
      stageAward('lesson-1', LessonStepKind.THEORY).sourceKey,
    );
  });

  it('carries no timestamp, so rewatching can never mint a new key', () => {
    const first = stageAward('lesson-1', LessonStepKind.VIDEO);
    const later = stageAward('lesson-1', LessonStepKind.VIDEO);
    expect(later.sourceKey).toBe(first.sourceKey);
  });
});

describe('taskPassedAward', () => {
  it('keys a quiz pass by task AND type', () => {
    expect(taskPassedAward('task-9', LessonTaskType.QUIZ)).toEqual({
      source: XpSource.TASK_PASSED,
      sourceKey: 'task:task-9:QUIZ:passed',
      amount: 30,
    });
  });

  it('keys a practice pass distinguishably from a quiz pass', () => {
    // FIRST_QUIZ_PASS must not be credited by a practice pass. The type is in
    // the key so that check never has to infer it from the amount — which
    // would break silently the day the two rewards are made equal.
    expect(taskPassedAward('task-9', LessonTaskType.PRACTICE).sourceKey).toBe(
      'task:task-9:PRACTICE:passed',
    );
    expect(
      isQuizPassKey(taskPassedAward('t', LessonTaskType.QUIZ).sourceKey),
    ).toBe(true);
    expect(
      isQuizPassKey(taskPassedAward('t', LessonTaskType.PRACTICE).sourceKey),
    ).toBe(false);
  });

  it('pays more for practice than for quiz', () => {
    // Practice is the harder, prerequisite-gated stage.
    const quiz = taskPassedAward('task-9', LessonTaskType.QUIZ);
    const practice = taskPassedAward('task-9', LessonTaskType.PRACTICE);
    expect(practice.amount).toBe(40);
    expect(practice.amount).toBeGreaterThan(quiz.amount);
  });

  it('carries no attempt number, so a retake reuses the same key', () => {
    // LessonTaskProgress.completedAt is stamped on the first pass and never
    // re-stamped; the key must agree with that.
    expect(taskPassedAward('task-9', LessonTaskType.QUIZ).sourceKey).toBe(
      taskPassedAward('task-9', LessonTaskType.QUIZ).sourceKey,
    );
  });
});

describe('trapClearedAward', () => {
  it('keys by task and question', () => {
    expect(trapClearedAward('task-9', 'q-3')).toEqual({
      source: XpSource.TRAP_CLEARED,
      sourceKey: 'trap:task-9:q-3',
      amount: 5,
    });
  });

  it('gives every trap in one task its own key', () => {
    expect(trapClearedAward('task-9', 'q-3').sourceKey).not.toBe(
      trapClearedAward('task-9', 'q-4').sourceKey,
    );
  });
});

describe('wordReviewedAward', () => {
  it("reuses the client's own idempotency key", () => {
    // Not a fresh key of our own: a replayed review is the SAME event that
    // WordReviewLog.clientReviewId already recognises, and the ledger must
    // agree with it rather than invent a second opinion.
    expect(wordReviewedAward('rev-abc')).toEqual({
      source: XpSource.WORD_REVIEWED,
      sourceKey: 'review:rev-abc',
      amount: 1,
    });
  });
});

describe('wordMasteredAward', () => {
  it('keys by word alone', () => {
    expect(wordMasteredAward('word-7')).toEqual({
      source: XpSource.WORD_MASTERED,
      sourceKey: 'word:word-7:mastered',
      amount: 15,
    });
  });

  it('CLOSES THE LAPSE FARM: re-mastering the same word reuses the key', () => {
    // UserWordProgress.masteredAt is NOT one-way — srs/scheduler.ts clears it
    // on a lapse (MASTERED + AGAIN/HARD) and stamps it again on re-mastery.
    // A key carrying an occurrence count or a timestamp would mint a fresh,
    // unclaimed key each cycle, and this loop is entirely student-controlled:
    //
    //     rate AGAIN -> lapse -> re-learn -> MASTERED -> +15 XP -> repeat
    //
    // Paying only for the first mastery ever closes it. If this test fails,
    // an infinite XP farm has been opened.
    const firstMastery = wordMasteredAward('word-7');
    const afterLapseAndRemastery = wordMasteredAward('word-7');
    expect(afterLapseAndRemastery.sourceKey).toBe(firstMastery.sourceKey);
  });
});

describe('achievementAward', () => {
  it('keys by achievement key and takes its amount from the catalog', () => {
    expect(achievementAward('FIRST_STAGE', 20)).toEqual({
      source: XpSource.ACHIEVEMENT,
      sourceKey: 'achievement:FIRST_STAGE',
      amount: 20,
    });
  });

  it('produces a distinct key per achievement', () => {
    expect(achievementAward('STREAK_3', 25).sourceKey).not.toBe(
      achievementAward('STREAK_7', 60).sourceKey,
    );
  });
});

describe('key namespaces', () => {
  it('never collide across award types', () => {
    // All keys share one per-user namespace via @@unique([userId, sourceKey]),
    // so a lesson id colliding with a task id must still produce two rows.
    const keys = [
      stageAward('x', LessonStepKind.VIDEO).sourceKey,
      stageAward('x', LessonStepKind.THEORY).sourceKey,
      taskPassedAward('x', LessonTaskType.QUIZ).sourceKey,
      trapClearedAward('x', 'x').sourceKey,
      wordReviewedAward('x').sourceKey,
      wordMasteredAward('x').sourceKey,
      achievementAward('x', 1).sourceKey,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
