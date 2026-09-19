import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { LessonMilestoneService } from './lesson-milestone.service';

// Integration coverage against real Postgres, same convention as this
// sprint's other new services. The property under test — 10 completed
// lessons reusing the EXACT roadmap-based definition Sprint 15's admin
// overview already established, and the reward firing exactly once — needs
// real Roadmap/Lesson/LessonStepProgress rows, not mocks.
describe('LessonMilestoneService (integration — real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: LessonMilestoneService;

  const createdUserIds: string[] = [];
  const createdCourseIds: string[] = [];

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        email: `lesson-milestone-test-${randomUUID()}@example.test`,
        name: 'Lesson Milestone Test User',
        password: 'irrelevant',
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  };

  // A course whose lessons have ONLY the 'video' stage — same fixture shape
  // Sprint 15's own admin-student-management.e2e-spec.ts already
  // established for this exact reason (one LessonStepProgress row per
  // lesson is enough to mark it complete).
  const createCourseWithVideoOnlyLessons = async (
    lessonCount: number,
  ): Promise<{ courseId: string; lessonIds: string[] }> => {
    const course = await prisma.course.create({
      data: {
        title: `milestone-course-${randomUUID().slice(0, 8)}`,
        type: 'GRAMMAR',
        description: 'fixture course',
        isPublished: true,
      },
    });
    createdCourseIds.push(course.id);
    const lessonIds: string[] = [];
    for (let i = 0; i < lessonCount; i += 1) {
      const lesson = await prisma.lesson.create({
        data: {
          courseId: course.id,
          title: `milestone-lesson-${i}-${randomUUID().slice(0, 6)}`,
          orderIndex: i,
          isPublished: true,
          videoUrl: 'https://youtu.be/fixture',
          notes: null,
        },
      });
      lessonIds.push(lesson.id);
    }
    return { courseId: course.id, lessonIds };
  };

  const markVideoCompleted = (userId: string, lessonId: string) =>
    prisma.lessonStepProgress.create({
      data: {
        userId,
        lessonId,
        step: 'VIDEO',
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

  const createRoadmapForCourse = (userId: string, courseId: string) =>
    prisma.roadmap.create({
      data: {
        userId,
        goal: 'GENERAL_ENGLISH',
        items: [
          {
            phase: 1,
            pillar: 'GRAMMAR',
            resourceType: 'COURSE',
            resourceId: courseId,
            reason: 'fixture',
          },
        ],
      },
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(LessonMilestoneService);
  }, 30000);

  afterAll(async () => {
    if (createdCourseIds.length) {
      const where = { courseId: { in: createdCourseIds } };
      await prisma.lessonStepProgress.deleteMany({ where: { lesson: where } });
      await prisma.lesson.deleteMany({ where });
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleRef.close();
  }, 30000);

  it('does nothing for a user under the 10-lesson threshold', async () => {
    const userId = await createUser();
    const { courseId, lessonIds } = await createCourseWithVideoOnlyLessons(9);
    await createRoadmapForCourse(userId, courseId);
    for (const id of lessonIds) await markVideoCompleted(userId, id);

    await service.checkAndGrant(userId);

    await expect(
      prisma.subscription.findUnique({ where: { userId } }),
    ).resolves.toBeNull();
  });

  it('grants +7 days PRO exactly once someone crosses 10 completed lessons', async () => {
    const userId = await createUser();
    const { courseId, lessonIds } = await createCourseWithVideoOnlyLessons(10);
    await createRoadmapForCourse(userId, courseId);
    for (const id of lessonIds) await markVideoCompleted(userId, id);

    await service.checkAndGrant(userId);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });
    const daysLeft =
      (sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(6.9);
    expect(daysLeft).toBeLessThan(7.1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lessonMilestoneRewardedAt).not.toBeNull();
  });

  it('never grants a second time once already rewarded', async () => {
    const userId = await createUser();
    const { courseId, lessonIds } = await createCourseWithVideoOnlyLessons(10);
    await createRoadmapForCourse(userId, courseId);
    for (const id of lessonIds) await markVideoCompleted(userId, id);

    await service.checkAndGrant(userId);
    await service.checkAndGrant(userId); // second call, same user

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { userId },
    });
    const daysLeft =
      (sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeLessThan(7.1); // still ~7, not ~14
  });

  it('a user with no roadmap at all is a safe no-op, never throws', async () => {
    const userId = await createUser();

    await expect(service.checkAndGrant(userId)).resolves.toBeUndefined();
  });
});
