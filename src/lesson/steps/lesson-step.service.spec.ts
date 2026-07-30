import { LessonStepKind } from '@prisma/client';
import { LessonStepService } from './lesson-step.service';

// Sprint 07 — the video completion rule and the two invariants that keep a
// finished step finished.
//
// Pure unit tests against a mocked Prisma: the rule is arithmetic plus two
// `??` guards, and it deserves to be readable without a database.

const publishedLesson = {
  isPublished: true,
  course: { isPublished: true },
};

interface BuildOptions {
  existing?: Record<string, unknown> | null;
  videoDurationMinutes?: number | null;
  videoUrl?: string | null;
  notes?: string | null;
}

const build = (options: BuildOptions = {}) => {
  const {
    existing = null,
    videoDurationMinutes = null,
    videoUrl = 'https://youtu.be/abc',
    notes = '# Theory',
  } = options;

  // The service calls lesson.findUnique twice: once through
  // assertLessonVisible (publication check) and once for the content check.
  let lessonCall = 0;
  const write = jest.fn((args: { data: Record<string, unknown> }) => ({
    ...(existing ?? {}),
    ...args.data,
  }));

  const prisma = {
    lesson: {
      findUnique: jest.fn(() => {
        lessonCall += 1;
        return lessonCall === 1
          ? publishedLesson
          : { id: 'l1', videoUrl, notes, videoDurationMinutes };
      }),
    },
    lessonStepProgress: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        lessonStepProgress: {
          findUnique: jest.fn().mockResolvedValue(existing),
          create: write,
          update: write,
        },
      }),
    ),
  };

  return {
    service: new LessonStepService(prisma as never),
    write,
  };
};

const report = (
  service: LessonStepService,
  positionSeconds: number,
  durationSeconds: number,
) =>
  service.recordVideoProgress('l1', 'u1', { positionSeconds, durationSeconds });

describe('LessonStepService — video completion', () => {
  it('does not complete below the 90% threshold', async () => {
    const { service } = build();
    const res = await report(service, 400, 600); // 66%
    expect(res.completedAt).toBeNull();
    expect(res.startedAt).not.toBeNull();
  });

  it('does not complete at 89%', async () => {
    const { service } = build();
    const res = await report(service, 534, 600); // 89%
    expect(res.completedAt).toBeNull();
  });

  it('completes exactly at 90%', async () => {
    const { service } = build();
    const res = await report(service, 540, 600);
    expect(res.completedAt).not.toBeNull();
  });

  it('completes at the very end', async () => {
    const { service } = build();
    const res = await report(service, 600, 600);
    expect(res.completedAt).not.toBeNull();
  });

  // The chosen product rule: no anti-seek. Dragging to the end counts.
  it('completes when the student seeks straight to the end', async () => {
    const { service } = build({ existing: null });
    const res = await report(service, 600, 600);
    expect(res.completedAt).not.toBeNull();
  });

  it('clamps a position reported beyond the end', async () => {
    const { service } = build();
    const res = await report(service, 9_000, 600);
    expect(res.highestPositionSeconds).toBe(600);
  });

  it('prefers the authored duration over the client-reported one', async () => {
    // Authored 10 minutes; the client claims the video is only 100s long and
    // it is at the end. Against the authored 600s that is 17%, not 100%.
    const { service } = build({ videoDurationMinutes: 10 });
    const res = await report(service, 100, 100);
    expect(res.completedAt).toBeNull();
  });
});

describe('LessonStepService — anti-forgery on the denominator', () => {
  // M-3. Without the write-once freeze, a client that has watched a real video
  // could later post a tiny duration and complete it from any position.
  it('measures against the FROZEN duration, not a later smaller one', async () => {
    const { service } = build({
      existing: {
        id: 's1',
        startedAt: new Date(),
        completedAt: null,
        highestPositionSeconds: 60,
        videoDurationSeconds: 600,
      },
    });
    const res = await report(service, 10, 10);
    expect(res.videoDurationSeconds).toBe(600);
    expect(res.completedAt).toBeNull();
  });

  // The freeze only helps once an honest report has landed. The floor is what
  // closes the very first request.
  it('never completes a video whose whole duration is below the floor', async () => {
    const { service } = build();
    const res = await report(service, 1, 1);
    expect(res.completedAt).toBeNull();
    // Progress is still recorded — only completion is withheld.
    expect(res.highestPositionSeconds).toBe(1);
  });
});

describe('LessonStepService — a finished step stays finished', () => {
  it('does not clear completedAt when the student rewatches from the start', async () => {
    const completedAt = new Date('2026-01-01T00:00:00.000Z');
    const { service } = build({
      existing: {
        id: 's1',
        startedAt: completedAt,
        completedAt,
        highestPositionSeconds: 600,
        videoDurationSeconds: 600,
      },
    });
    const res = await report(service, 3, 600);
    expect(res.completedAt).toBe(completedAt.toISOString());
  });

  it('does not restamp completedAt on a later report', async () => {
    const completedAt = new Date('2026-01-01T00:00:00.000Z');
    const { service } = build({
      existing: {
        id: 's1',
        startedAt: completedAt,
        completedAt,
        highestPositionSeconds: 600,
        videoDurationSeconds: 600,
      },
    });
    const res = await report(service, 600, 600);
    expect(res.completedAt).toBe(completedAt.toISOString());
  });

  it('keeps highestPositionSeconds monotonic when the student seeks back', async () => {
    const { service } = build({
      existing: {
        id: 's1',
        startedAt: new Date(),
        completedAt: null,
        highestPositionSeconds: 300,
        videoDurationSeconds: 600,
      },
    });
    const res = await report(service, 10, 600);
    expect(res.highestPositionSeconds).toBe(300);
  });
});

describe('LessonStepService — theory', () => {
  it('start marks in progress without completing', async () => {
    const { service } = build();
    const res = await service.startTheory('l1', 'u1');
    expect(res.startedAt).not.toBeNull();
    expect(res.completedAt).toBeNull();
  });

  it('start is idempotent — a second call keeps the first timestamp', async () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const { service } = build({
      existing: { id: 's1', startedAt, completedAt: null },
    });
    const res = await service.startTheory('l1', 'u1');
    expect(res.startedAt).toBe(startedAt.toISOString());
  });

  it('complete without a prior start still yields a coherent row', async () => {
    const { service } = build();
    const res = await service.completeTheory('l1', 'u1');
    expect(res.startedAt).not.toBeNull();
    expect(res.completedAt).not.toBeNull();
  });

  it('complete is idempotent — re-reading finished theory never restamps it', async () => {
    const completedAt = new Date('2026-01-01T00:00:00.000Z');
    const { service } = build({
      existing: { id: 's1', startedAt: completedAt, completedAt },
    });
    const res = await service.completeTheory('l1', 'u1');
    expect(res.completedAt).toBe(completedAt.toISOString());
  });

  it('404s when the lesson has no notes to read', async () => {
    const { service } = build({ notes: null });
    await expect(service.completeTheory('l1', 'u1')).rejects.toThrow();
  });

  it('404s when the lesson has no video to watch', async () => {
    const { service } = build({ videoUrl: null });
    await expect(report(service, 10, 600)).rejects.toThrow();
  });
});

describe('LessonStepService — derived state carries no stored status', () => {
  // H-4. The DTO must expose timestamps only; a stored status enum beside them
  // is the second representation that made LessonTaskProgress.status wrong.
  it('returns timestamps and never a status field', async () => {
    const { service } = build();
    const res = await service.startTheory('l1', 'u1');
    expect(res).not.toHaveProperty('status');
    expect(res.step).toBe(LessonStepKind.THEORY);
  });
});
