import { CefrLevel, LearningGoal, PrismaClient } from '@prisma/client';

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
  /** Roadmap eligibility — see the schema comment on SpeakingScenario.suitableGoals. Defaults to []. */
  suitableGoals?: LearningGoal[];
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
    name: 'Greeting a new colleague',
    nameVi: 'Chào hỏi đồng nghiệp mới',
    description: 'Practice greeting and making small talk with a new colleague on their first day at work.',
    descriptionVi: 'Luyện cách chào hỏi và trò chuyện xã giao với một đồng nghiệp mới trong ngày đầu đi làm.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: "Meeting Patricia on her first day",
        titleVi: 'Gặp Patricia trong ngày đầu tiên',
        description:
          'Patricia is your new colleague, and today is her first day at the company. Welcome her and help her feel comfortable.',
        descriptionVi:
          'Patricia là đồng nghiệp mới của bạn, và hôm nay là ngày đầu tiên cô ấy đi làm. Hãy chào đón và giúp cô ấy cảm thấy thoải mái.',
        level: CefrLevel.A1,
        aiRole: 'Patricia, a new colleague on her first day at the company, a little nervous but friendly',
        openingLine: "Hi, I'm Patricia — I just started today. Is this the marketing team?",
        conversationGoal:
          'Get the student to welcome Patricia, introduce themselves, and offer at least one helpful piece of information about the workplace.',
      },
    ],
  },
  {
    name: 'Ordering food at a restaurant',
    nameVi: 'Gọi món tại nhà hàng',
    description: 'Practice ordering food and drinks at a restaurant.',
    descriptionVi: 'Luyện cách gọi món ăn và thức uống tại nhà hàng.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Ordering lunch from Tom',
        titleVi: 'Gọi món trưa với Tom',
        description:
          'You are at a small restaurant and want to order lunch. Tom, the waiter, is friendly and ready to take your order.',
        descriptionVi:
          'Bạn đang ở một nhà hàng nhỏ và muốn gọi món trưa. Tom, người phục vụ, rất thân thiện và sẵn sàng ghi order của bạn.',
        level: CefrLevel.A1,
        aiRole: 'Tom, a friendly waiter at a small restaurant taking a lunch order',
        openingLine: 'Hi there! Welcome in. Are you ready to order, or do you need a few more minutes?',
        conversationGoal:
          'Get the student to order at least one dish and one drink, and answer at least one follow-up question, such as about spice level or size.',
      },
    ],
  },
  {
    name: 'Asking for directions',
    nameVi: 'Hỏi đường',
    description: 'Practice asking a stranger for directions in an unfamiliar city.',
    descriptionVi: 'Luyện cách hỏi đường một người lạ khi bạn ở một thành phố xa lạ.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Finding the train station',
        titleVi: 'Tìm ga tàu',
        description:
          'You are lost in a new city and need to find the train station. Ask a local person for directions.',
        descriptionVi:
          'Bạn bị lạc ở một thành phố mới và cần tìm ga tàu. Hãy hỏi đường một người dân địa phương.',
        level: CefrLevel.A1,
        aiRole: 'a helpful local resident stopped on the street by a lost tourist',
        openingLine: 'Hello! You look a little lost — can I help you find something?',
        conversationGoal:
          'Get the student to ask how to reach the train station and confirm they understood the directions, e.g. by repeating them back.',
      },
    ],
  },
  {
    name: 'Shopping at a clothing store',
    nameVi: 'Mua sắm tại cửa hàng quần áo',
    description: 'Practice asking for help and trying on clothes at a clothing store.',
    descriptionVi: 'Luyện cách nhờ giúp đỡ và thử đồ tại cửa hàng quần áo.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Buying a new shirt with Lisa',
        titleVi: 'Mua áo sơ mi mới với Lisa',
        description:
          'You want to buy a new shirt at a clothing store. Lisa, the shop assistant, is ready to help you find the right size and color.',
        descriptionVi:
          'Bạn muốn mua một chiếc áo sơ mi mới tại cửa hàng quần áo. Lisa, nhân viên bán hàng, sẽ giúp bạn tìm đúng size và màu.',
        level: CefrLevel.A1,
        aiRole: 'Lisa, a helpful shop assistant at a clothing store',
        openingLine: 'Hi! Welcome in. Are you looking for anything in particular today?',
        conversationGoal:
          'Get the student to describe the shirt they want (color/size) and ask at least one question, like where to try it on or the price.',
      },
    ],
  },
  {
    name: 'Checking in at a hotel',
    nameVi: 'Nhận phòng khách sạn',
    description: 'Practice checking in and asking questions at a hotel front desk.',
    descriptionVi: 'Luyện cách làm thủ tục nhận phòng và đặt câu hỏi tại quầy lễ tân khách sạn.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Checking in with David',
        titleVi: 'Nhận phòng cùng David',
        description:
          'You have arrived at a hotel and need to check in. David, the receptionist, will help you with your reservation.',
        descriptionVi:
          'Bạn vừa đến khách sạn và cần làm thủ tục nhận phòng. David, lễ tân, sẽ giúp bạn với thông tin đặt phòng.',
        level: CefrLevel.A1,
        aiRole: 'David, a polite hotel receptionist checking a guest in',
        openingLine: 'Good afternoon! Welcome to our hotel. Do you have a reservation with us?',
        conversationGoal:
          'Get the student to confirm their reservation or name and ask at least one question about the room or hotel, e.g. breakfast time or Wi-Fi.',
      },
    ],
  },
  {
    name: 'Talking about your family',
    nameVi: 'Nói về gia đình bạn',
    description: 'Practice describing your family to someone you just met.',
    descriptionVi: 'Luyện cách miêu tả gia đình bạn với một người bạn vừa mới quen.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Chatting with Sarah about family',
        titleVi: 'Trò chuyện với Sarah về gia đình',
        description: 'You meet a new friend, Sarah, at a community event. She wants to know about your family.',
        descriptionVi:
          'Bạn gặp một người bạn mới, Sarah, tại một sự kiện cộng đồng. Cô ấy muốn biết về gia đình bạn.',
        level: CefrLevel.A1,
        aiRole: "Sarah, a friendly new acquaintance at a community event, curious about the student's family",
        openingLine: 'It’s so nice to meet you! Do you have a big family? Tell me about them.',
        conversationGoal: 'Get the student to mention at least two family members and one detail about each.',
      },
    ],
  },
  {
    name: 'Visiting a doctor',
    nameVi: 'Đi khám bác sĩ',
    description: "Practice describing symptoms and answering a doctor's questions.",
    descriptionVi: 'Luyện cách mô tả triệu chứng và trả lời câu hỏi khi đi khám bác sĩ.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Seeing Dr. Chen',
        titleVi: 'Khám bệnh với Dr. Chen',
        description: 'You are not feeling well and visit a doctor. Dr. Chen will ask about your symptoms.',
        descriptionVi: 'Bạn cảm thấy không khỏe và đi khám bác sĩ. Dr. Chen sẽ hỏi về triệu chứng của bạn.',
        level: CefrLevel.A1,
        aiRole: 'Dr. Chen, a calm and attentive doctor examining a patient',
        openingLine: 'Good morning. What seems to be the problem today?',
        conversationGoal: "Get the student to describe at least one symptom and how long they've had it.",
      },
    ],
  },
  {
    name: 'Buying a bus ticket',
    nameVi: 'Mua vé xe buýt',
    description: 'Practice buying a ticket and asking about schedules at a ticket counter.',
    descriptionVi: 'Luyện cách mua vé và hỏi về lịch trình tại quầy bán vé.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Buying a ticket to another city',
        titleVi: 'Mua vé đi thành phố khác',
        description: 'You want to travel by bus to another city. Go to the ticket counter and buy a ticket.',
        descriptionVi: 'Bạn muốn đi xe buýt đến một thành phố khác. Hãy đến quầy vé và mua vé.',
        level: CefrLevel.A1,
        aiRole: 'a bus station ticket clerk helping a traveler',
        openingLine: 'Hello, where would you like to travel to today?',
        conversationGoal:
          'Get the student to name a destination and ask at least one question, like the price or departure time.',
      },
    ],
  },
  {
    name: 'Talking about the weather',
    nameVi: 'Nói về thời tiết',
    description: 'Practice small talk about the weather with a neighbor.',
    descriptionVi: 'Luyện cách trò chuyện xã giao về thời tiết với hàng xóm.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Morning chat with Emma',
        titleVi: 'Trò chuyện buổi sáng với Emma',
        description: 'You meet your neighbor, Emma, in the morning. Start a casual conversation about the weather.',
        descriptionVi:
          'Bạn gặp hàng xóm của mình, Emma, vào buổi sáng. Hãy bắt đầu một cuộc trò chuyện xã giao về thời tiết.',
        level: CefrLevel.A1,
        aiRole: 'Emma, a friendly neighbor chatting outside in the morning',
        openingLine: 'Good morning! Beautiful day today, isn’t it?',
        conversationGoal:
          'Get the student to comment on the weather and ask at least one follow-up question or mention a related plan, e.g. a weekend activity.',
      },
    ],
  },
  {
    name: 'Introducing yourself at a party',
    nameVi: 'Tự giới thiệu tại bữa tiệc',
    description: 'Practice introducing yourself to strangers at a party.',
    descriptionVi: 'Luyện cách tự giới thiệu bản thân với những người lạ tại một bữa tiệc.',
    level: CefrLevel.A1,
    exercises: [
      {
        title: 'Meeting people at a birthday party',
        titleVi: 'Làm quen tại tiệc sinh nhật',
        description: "You are at a birthday party and don't know many people. Start talking to someone new.",
        descriptionVi:
          'Bạn đang ở một bữa tiệc sinh nhật và không quen biết nhiều người. Hãy bắt đầu trò chuyện với một người mới.',
        level: CefrLevel.A1,
        aiRole: 'another guest at the birthday party, friendly and easy to talk to',
        openingLine: "Hi! I don't think we've met — are you a friend of the birthday person?",
        conversationGoal:
          'Get the student to introduce their name and how they know the host, then ask the other guest a question back.',
      },
    ],
  },
  {
    name: 'Free Talk',
    nameVi: 'Nói chuyện tự do',
    description: 'An open conversation on any topic the student wants — no fixed scenario.',
    descriptionVi: 'Trò chuyện tự do về bất kỳ chủ đề nào bạn muốn — không theo kịch bản cố định.',
    isFreeTalk: true,
    // Roadmap: the ONE speaking scenario the deterministic/AI roadmap
    // planners are allowed to recommend, and only for GENERAL_ENGLISH
    // ("Tiếng Anh giao tiếp") — see PlacementService.loadAvailableResources.
    suitableGoals: [LearningGoal.GENERAL_ENGLISH],
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
        suitableGoals: scenario.suitableGoals ?? [],
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
