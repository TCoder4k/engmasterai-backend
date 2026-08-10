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
    // Sprint 07 — LessonTaskAttempt.task is `Restrict` for the same reason
    // LessonTaskProgress.task is: real attempt history must not be silently
    // destroyed by deleting the content it belongs to. That makes this sweep
    // REQUIRED, not redundant — without it the first e2e test that submits a
    // quiz leaves a row that blocks the lessonTask.deleteMany below, and every
    // later suite in the run inherits the poisoned fixture.
    await prisma.lessonTaskAttempt.deleteMany({
      where: { task: { lesson: fixtureLessonWhere } },
    });
    // NOTE: lessonStepProgress needs NO entry here. Both of its relations
    // (user, lesson) are onDelete: Cascade, so its rows go with either the
    // user sweep below or the lesson sweep further down. Adding a deleteMany
    // for it would be harmless but misleading — it would imply a Restrict
    // relation that does not exist. Do not "fix" this omission.
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

    // NOTE: vocabGuessProgress needs NO entry here, same reasoning as
    // userWordProgress just above (no entry for it either): its `user`
    // relation is Cascade and its `deck`/`word` relations are Restrict, so
    // the user sweep above already removes every fixture-owned row before
    // the deck/word deletes below run. A row would only survive to block
    // those deletes if it belonged to a non-`@example.test` user, which no
    // guess-progress e2e test should ever create.
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

    // Sprint 11 (Listening content) — content BEFORE categories, because
    // ListeningContent.category is `Restrict`: a fixture category holding a
    // recording cannot be deleted, and leaving it behind would poison every
    // later suite in the run exactly as an unswept LessonTask does.
    //
    // Matched on the content's own title OR its category's name, so a
    // recording still gets swept if a future test forgets to namespace it.
    //
    // NOTE: listeningSegment needs NO entry. ListeningSegment.content is
    // onDelete: Cascade, so segments go with the content below. Adding a
    // deleteMany for it would be harmless but misleading — it would imply a
    // Restrict relation that does not exist. Same reasoning as the
    // lessonStepProgress note above; do not "fix" this omission.
    //
    // Sprint 11 Phase 4A — these two DO need entries, and they must run
    // BEFORE the content delete below. Both hold `content` as **Restrict**
    // (that is the whole point of those relations: they stop an admin from
    // deleting a recording students have practised), so a leftover attempt or
    // progress row makes the content delete throw P2003 and every later suite
    // in the run inherits the wreckage.
    //
    // Attempts first, then progress: no FK links them, but keeping the order
    // "most dependent first" is what makes this list readable as a graph.
    // Sprint 11 Phase 4B. Both shadowing tables are Restrict on the CONTENT,
    // exactly as the dictation pair is, so both must be gone before the
    // content delete below or it throws P2003 and poisons every later suite.
    await prisma.listeningShadowingAttempt.deleteMany({
      where: {
        content: {
          OR: [
            { title: { startsWith: TEST_FIXTURE_PREFIX } },
            { category: { name: { startsWith: TEST_FIXTURE_PREFIX } } },
          ],
        },
      },
    });
    await prisma.listeningShadowingSegmentProgress.deleteMany({
      where: {
        content: {
          OR: [
            { title: { startsWith: TEST_FIXTURE_PREFIX } },
            { category: { name: { startsWith: TEST_FIXTURE_PREFIX } } },
          ],
        },
      },
    });

    await prisma.listeningDictationAttempt.deleteMany({
      where: {
        content: {
          OR: [
            { title: { startsWith: TEST_FIXTURE_PREFIX } },
            { category: { name: { startsWith: TEST_FIXTURE_PREFIX } } },
          ],
        },
      },
    });
    await prisma.listeningDictationSegmentProgress.deleteMany({
      where: {
        content: {
          OR: [
            { title: { startsWith: TEST_FIXTURE_PREFIX } },
            { category: { name: { startsWith: TEST_FIXTURE_PREFIX } } },
          ],
        },
      },
    });
    await prisma.listeningContent.deleteMany({
      where: {
        OR: [
          { title: { startsWith: TEST_FIXTURE_PREFIX } },
          { category: { name: { startsWith: TEST_FIXTURE_PREFIX } } },
        ],
      },
    });
    await prisma.listeningCategory.deleteMany({
      where: { name: { startsWith: TEST_FIXTURE_PREFIX } },
    });
  } finally {
    await prisma.$disconnect();
  }
}
