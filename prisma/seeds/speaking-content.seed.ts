import { CefrLevel, PrismaClient } from '@prisma/client';

// Sprint 13 — real, reusable Speaking Partner content. Unlike the Listening
// migration seed, there is no media dependency blocking publication here: a
// Speaking exercise's only prerequisite is authored text (aiRole,
// openingLine, description), all of which is written directly below. So,
// unlike `listening-content.seed.ts`, this seeds PUBLISHED content — there is
// nothing for an admin to attach afterward.
//
// Idempotent: the scenario is matched by name and exercises by title, both
// create-or-reuse, same contract as the Listening seed and the vocab
// importer. Re-running adds nothing and overwrites nothing.
//
// Run with:  npm run seed:speaking

const prisma = new PrismaClient();

interface SeedExercise {
  title: string;
  titleVi: string;
  description: string;
  /** Added 2026-08-20 — see the schema comment on SpeakingExercise.descriptionVi. */
  descriptionVi: string;
  level: CefrLevel;
  aiRole: string;
  openingLine: string;
  conversationGoal: string;
}

interface SeedScenario {
  name: string;
  nameVi: string;
  description: string;
  descriptionVi: string;
  /** Optional — the one Free Talk scenario spans every level, so it has none. */
  level?: CefrLevel;
  /** Marks the one open-topic scenario — see the schema comment on SpeakingScenario.isFreeTalk. */
  isFreeTalk?: boolean;
  exercises: SeedExercise[];
}

const SCENARIOS: SeedScenario[] = [
  {
    name: 'Self-introduction',
    nameVi: 'Giới thiệu bản thân',
    description: 'Practice introducing yourself in everyday English conversations.',
    descriptionVi: 'Luyện cách giới thiệu bản thân trong các tình huống giao tiếp tiếng Anh hằng ngày.',
    level: CefrLevel.A2,
    exercises: [
      {
        title: 'Meeting someone new',
        titleVi: 'Làm quen với người mới',
        description: 'Introduce your name, age and where you are from to someone you just met.',
        descriptionVi: 'Giới thiệu tên, tuổi và quê quán của bạn với một người bạn vừa mới gặp.',
        level: CefrLevel.A2,
        aiRole: 'a friendly stranger meeting the student for the first time at a social event',
        openingLine: 'Hello! Welcome to our conversation. Can you tell me a little bit about yourself?',
        conversationGoal:
          'Get the student to share their name, age, and where they are from, then ask one follow-up question.',
      },
      {
        title: 'Work and hobbies',
        titleVi: 'Công việc và sở thích',
        description: 'Talk about what you do for work or study, and what you enjoy doing in your free time.',
        descriptionVi: 'Nói về công việc hoặc việc học của bạn, và những gì bạn thích làm lúc rảnh rỗi.',
        level: CefrLevel.A2,
        aiRole: 'a curious new coworker chatting during a coffee break',
        openingLine: 'Great to meet you! What do you do for work, and what do you enjoy doing in your free time?',
        conversationGoal:
          'Get the student to name their job or field of study and at least one hobby.',
      },
      {
        title: 'Family and hometown',
        titleVi: 'Gia đình và quê hương',
        description: 'Describe your family and the place you grew up.',
        descriptionVi: 'Miêu tả gia đình bạn và nơi bạn lớn lên.',
        level: CefrLevel.A2,
        aiRole: 'a friendly neighbor chatting over the fence',
        openingLine: "I don't think we've properly met! Tell me about your family and where you grew up.",
        conversationGoal:
          'Get the student to mention at least one family member and one detail about their hometown.',
      },
      {
        title: 'Daily routine',
        titleVi: 'Thói quen hằng ngày',
        description: 'Describe a typical day, from morning to evening.',
        descriptionVi: 'Miêu tả một ngày bình thường của bạn, từ sáng đến tối.',
        level: CefrLevel.A2,
        aiRole: 'a language exchange partner practicing small talk',
        openingLine: "Let's get to know each other better — what does a typical day look like for you?",
        conversationGoal:
          'Get the student to describe at least two parts of their daily routine in order.',
      },
      {
        title: 'Future plans',
        titleVi: 'Kế hoạch tương lai',
        description: 'Talk about your goals and plans for the near future.',
        descriptionVi: 'Nói về mục tiêu và dự định của bạn trong thời gian tới.',
        level: CefrLevel.A2,
        aiRole: 'a supportive mentor asking about goals',
        openingLine: "It's nice to finally chat with you! What are you hoping to do or achieve in the near future?",
        conversationGoal:
          'Get the student to name at least one concrete goal and say roughly when they hope to reach it.',
      },
    ],
  },
  {
    name: 'Free Talk',
    nameVi: 'Nói chuyện tự do',
    description: 'An open conversation on any topic the student wants — no fixed scenario.',
    descriptionVi: 'Trò chuyện tự do về bất kỳ chủ đề nào bạn muốn — không theo kịch bản cố định.',
    isFreeTalk: true,
    exercises: [
      {
        title: 'Open conversation',
        titleVi: 'Trò chuyện tự do',
        description: 'Talk about anything you like — the AI follows wherever you take the conversation.',
        descriptionVi: 'Nói về bất cứ điều gì bạn thích — AI sẽ theo hướng mà bạn dẫn dắt cuộc trò chuyện.',
        level: CefrLevel.B1,
        aiRole: 'a friendly, curious English conversation partner with no fixed agenda',
        openingLine: 'Hi! What would you like to talk about today?',
        conversationGoal:
          'Keep the conversation going naturally on whatever the student brings up — never steer it toward a specific topic of your own.',
      },
    ],
  },
];

const seedScenario = async (scenario: SeedScenario, orderIndex: number): Promise<void> => {
  let scenarioId: string;
  const existingScenario = await prisma.speakingScenario.findFirst({
    where: { name: scenario.name },
    select: { id: true, descriptionVi: true },
  });

  if (existingScenario) {
    scenarioId = existingScenario.id;
    // Targeted backfill ONLY, added 2026-08-20 alongside descriptionVi
    // itself — a scenario created before this field existed would
    // otherwise stay stuck without a Vietnamese description forever under
    // the "create-or-reuse, never overwrite" rule. Every OTHER field on an
    // existing match is still left completely untouched.
    if (!existingScenario.descriptionVi) {
      await prisma.speakingScenario.update({
        where: { id: scenarioId },
        data: { descriptionVi: scenario.descriptionVi },
      });
      console.log(`  · ${scenario.name} — already present, backfilled descriptionVi`);
    } else {
      console.log(`  · ${scenario.name} — already present, left untouched`);
    }
  } else {
    const created = await prisma.speakingScenario.create({
      data: {
        name: scenario.name,
        nameVi: scenario.nameVi,
        description: scenario.description,
        descriptionVi: scenario.descriptionVi,
        level: scenario.level,
        orderIndex,
        isPublished: true,
        isFreeTalk: scenario.isFreeTalk ?? false,
      },
      select: { id: true },
    });
    scenarioId = created.id;
    console.log(`  ✓ ${scenario.name} — created, published`);
  }

  for (const [index, exercise] of scenario.exercises.entries()) {
    const existingExercise = await prisma.speakingExercise.findFirst({
      where: { scenarioId, title: exercise.title },
      select: { id: true, descriptionVi: true },
    });

    if (existingExercise) {
      // Same targeted backfill as the scenario above — descriptionVi only.
      if (!existingExercise.descriptionVi) {
        await prisma.speakingExercise.update({
          where: { id: existingExercise.id },
          data: { descriptionVi: exercise.descriptionVi },
        });
        console.log(`    · ${exercise.title} — already present, backfilled descriptionVi`);
      } else {
        console.log(`    · ${exercise.title} — already present, left untouched`);
      }
      continue;
    }

    await prisma.speakingExercise.create({
      data: {
        scenarioId,
        title: exercise.title,
        titleVi: exercise.titleVi,
        description: exercise.description,
        descriptionVi: exercise.descriptionVi,
        level: exercise.level,
        aiRole: exercise.aiRole,
        openingLine: exercise.openingLine,
        conversationGoal: exercise.conversationGoal,
        orderIndex: index,
        isPublished: true,
      },
    });
    console.log(`    ✓ ${exercise.title} — created, published`);
  }
};

const main = async (): Promise<void> => {
  console.log('\nSeeding Speaking Partner content (published)...\n');

  for (const [index, scenario] of SCENARIOS.entries()) {
    await seedScenario(scenario, index);
  }

  console.log('\nDone. /practice/speaking now has real, usable content.\n');
};

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
