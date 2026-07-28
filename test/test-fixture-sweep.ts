import { PrismaClient } from '@prisma/client';
import { TEST_FIXTURE_PREFIX } from './test-database.util';

/**
 * Removes every row a test run could have created, in FK-safe order.
 *
 * Run both BEFORE the suite (clearing residue from a previously interrupted
 * run) and AFTER it (the normal path). Per-suite `afterAll` hooks are not
 * enough on their own: they never execute when the jest process is killed,
 * which is exactly how the original leak happened.
 *
 * Only ever called against the test database — the caller asserts that first.
 */
export async function sweepTestFixtures(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    // Sprint 06B (Lesson Quiz Engine) — swept FIRST, before the user sweep
    // below. LessonTaskProgress.user cascades on user delete, so in the
    // common case this step is redundant with that cascade — but
    // LessonTask.lesson and Question.task are both `Restrict` (the
    // default), so a fixture lesson carrying a question could otherwise
    // survive the `lesson.deleteMany` below and poison every later run.
    // Matched by lesson/course title exactly like the lesson sweep further
    // down, not by user, so an orphaned row from an interrupted earlier run
    // is swept too.
    const fixtureLessonWhere = {
      OR: [
        { title: { startsWith: TEST_FIXTURE_PREFIX } },
        { course: { title: { startsWith: TEST_FIXTURE_PREFIX } } },
      ],
    };
    await prisma.lessonTaskProgress.deleteMany({
      where: { task: { lesson: fixtureLessonWhere } },
    });
    await prisma.question.deleteMany({
      where: { task: { lesson: fixtureLessonWhere } },
    });
    await prisma.lessonTask.deleteMany({
      where: { lesson: fixtureLessonWhere },
    });

    // Users first. `User` cascades to UserWordProgress and WordReviewLog,
    // and clearing those is what makes the words deletable at all — both
    // word relations are `onDelete: Restrict` precisely so that real
    // learning history can never be silently destroyed.
    //
    // `@example.test` is a reserved TLD that can never belong to a real
    // account, and is already the convention in both learning suites.
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@example.test' } },
    });

    const fixtureWords = { text: { startsWith: TEST_FIXTURE_PREFIX } };

    await prisma.vocabDeckWord.deleteMany({
      where: {
        OR: [
          { word: fixtureWords },
          { deck: { name: { startsWith: TEST_FIXTURE_PREFIX } } },
        ],
      },
    });
    // Meanings/examples cascade from the word, so they need no sweep of
    // their own.
    await prisma.vocabWord.deleteMany({ where: fixtureWords });
    await prisma.vocabDeck.deleteMany({
      where: { name: { startsWith: TEST_FIXTURE_PREFIX } },
    });
    await prisma.vocabLibrary.deleteMany({
      where: { name: { startsWith: TEST_FIXTURE_PREFIX } },
    });

    // Sprint 05 added course/lesson fixtures (course.e2e-spec.ts). Lessons
    // first — Lesson.course is a required relation with no cascade, so a
    // course with lessons cannot be deleted. Matching on the parent course's
    // title as well as the lesson's own means a lesson still gets swept even
    // if a future test forgets to namespace its title.
    await prisma.lesson.deleteMany({
      where: {
        OR: [
          { title: { startsWith: TEST_FIXTURE_PREFIX } },
          { course: { title: { startsWith: TEST_FIXTURE_PREFIX } } },
        ],
      },
    });
    await prisma.course.deleteMany({
      where: { title: { startsWith: TEST_FIXTURE_PREFIX } },
    });
  } finally {
    await prisma.$disconnect();
  }
}
