import { PrismaClient, QuestionType, QuestionDifficulty, CourseType } from '@prisma/client';
import { validateQuestionContent } from '../../src/lesson/quiz/grade-question';

// Personalized Onboarding & Placement Test — dev/seed content for the
// dedicated question bank (Phase 2). Idempotent, matched by exact `content`
// text (the bank's only natural stable identifier — there is no lesson/task
// to key off, unlike grammar-quizzes.seed.ts).
//
// Deliberately seeds MORE than the bare 2 EASY / 1 MEDIUM / 1 HARD per
// section POST /placement/start requires (see
// src/placement/placement.constants.ts): 4/2/2 per section, so sampling
// without replacement actually has something to vary between retakes rather
// than serving the identical 12 questions every time.
//
// Every question is validated through the API's own
// validateQuestionContent() before any write, so this script cannot seed
// content the real grader would reject.
//
// LISTENING items: `content` holds ONLY the question/statement/prompt shown
// on screen; `transcript` holds the spoken dialogue and is never rendered as
// text — the client reads it aloud (Web Speech API, via
// PlacementAudioPlayer) since there is no real recorded audioUrl yet.
// audioUrl stays null; once a real recording is attached for a question,
// the client prefers audioUrl over transcript playback automatically.
//
// Run with:  npm run seed:placement-questions

const prisma = new PrismaClient();

interface SeedQuestion {
  section: CourseType;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  content: string;
  options?: { id: string; text: string }[];
  correctAnswer: unknown;
  explanation?: string;
  // Listening-section items only — the spoken dialogue, read aloud
  // client-side rather than shown as text alongside `content`.
  transcript?: string;
}

const GRAMMAR: SeedQuestion[] = [
  {
    section: 'GRAMMAR',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    content: 'She ___ to the office every morning.',
    options: [
      { id: 'a', text: 'go' },
      { id: 'b', text: 'goes' },
      { id: 'c', text: 'going' },
      { id: 'd', text: 'gone' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: 'Simple present, third person singular subject "she" takes the -s form.',
  },
  {
    section: 'GRAMMAR',
    type: 'TRUE_FALSE',
    difficulty: 'EASY',
    content: '"They is students." is a grammatically correct sentence.',
    correctAnswer: { value: false },
    explanation: 'The plural subject "they" requires "are", not "is".',
  },
  {
    section: 'GRAMMAR',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    content: 'I ___ a book right now.',
    options: [
      { id: 'a', text: 'read' },
      { id: 'b', text: 'reads' },
      { id: 'c', text: 'am reading' },
      { id: 'd', text: 'reading' },
    ],
    correctAnswer: { optionId: 'c' },
    explanation: '"Right now" signals the present continuous: am/is/are + V-ing.',
  },
  {
    section: 'GRAMMAR',
    type: 'FILL_BLANK',
    difficulty: 'EASY',
    content: 'Complete: Yesterday, I ___ (go) to the market.',
    correctAnswer: { accepted: ['went'] },
    explanation: 'Simple past of the irregular verb "go" is "went".',
  },
  {
    section: 'GRAMMAR',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    content: 'By the time we arrived, the meeting ___ already ___.',
    options: [
      { id: 'a', text: 'has / started' },
      { id: 'b', text: 'had / started' },
      { id: 'c', text: 'have / started' },
      { id: 'd', text: 'was / starting' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: 'An action completed before another past action uses the past perfect: had + V3.',
  },
  {
    section: 'GRAMMAR',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    content: 'The report ___ by the manager before it is sent to the client.',
    options: [
      { id: 'a', text: 'must review' },
      { id: 'b', text: 'must be reviewed' },
      { id: 'c', text: 'must reviewing' },
      { id: 'd', text: 'must reviewed' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: 'The report does not review itself — passive voice is needed: must be + V3.',
  },
  {
    section: 'GRAMMAR',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'HARD',
    content: 'Not only ___ the deadline, but she also improved the quality of the report.',
    options: [
      { id: 'a', text: 'she met' },
      { id: 'b', text: 'did she meet' },
      { id: 'c', text: 'she did meet' },
      { id: 'd', text: 'meeting she' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: 'A negative/limiting adverbial ("Not only") fronted at the start of a clause triggers subject-auxiliary inversion.',
  },
  {
    section: 'GRAMMAR',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'HARD',
    content: 'If the shipment ___ on time, we would not have lost the contract.',
    options: [
      { id: 'a', text: 'arrived' },
      { id: 'b', text: 'had arrived' },
      { id: 'c', text: 'would arrive' },
      { id: 'd', text: 'arrives' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: 'A third-conditional counterfactual about the past pairs "if + had + V3" with "would have + V3".',
  },
];

const VOCABULARY: SeedQuestion[] = [
  {
    section: 'VOCABULARY',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    content: 'Choose the word closest in meaning to "happy".',
    options: [
      { id: 'a', text: 'glad' },
      { id: 'b', text: 'angry' },
      { id: 'c', text: 'tired' },
      { id: 'd', text: 'bored' },
    ],
    correctAnswer: { optionId: 'a' },
  },
  {
    section: 'VOCABULARY',
    type: 'TRUE_FALSE',
    difficulty: 'EASY',
    content: '"Purchase" means the same as "buy".',
    correctAnswer: { value: true },
  },
  {
    section: 'VOCABULARY',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    content: 'A place where you can borrow books is called a ___.',
    options: [
      { id: 'a', text: 'library' },
      { id: 'b', text: 'bakery' },
      { id: 'c', text: 'pharmacy' },
      { id: 'd', text: 'gallery' },
    ],
    correctAnswer: { optionId: 'a' },
  },
  {
    section: 'VOCABULARY',
    type: 'FILL_BLANK',
    difficulty: 'EASY',
    content: 'The opposite of "expensive" is ___.',
    correctAnswer: { accepted: ['cheap', 'inexpensive'] },
  },
  {
    section: 'VOCABULARY',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    content: 'The company decided to ___ the project due to budget cuts.',
    options: [
      { id: 'a', text: 'postpone' },
      { id: 'b', text: 'celebrate' },
      { id: 'c', text: 'welcome' },
      { id: 'd', text: 'compliment' },
    ],
    correctAnswer: { optionId: 'a' },
    explanation: '"Postpone" (delay) fits a budget-cut context; the other options do not make sense here.',
  },
  {
    section: 'VOCABULARY',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    content: 'Choose the word closest in meaning to "reluctant".',
    options: [
      { id: 'a', text: 'unwilling' },
      { id: 'b', text: 'eager' },
      { id: 'c', text: 'confident' },
      { id: 'd', text: 'generous' },
    ],
    correctAnswer: { optionId: 'a' },
  },
  {
    section: 'VOCABULARY',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'HARD',
    content: 'The negotiations reached an ___ after both sides made concessions.',
    options: [
      { id: 'a', text: 'impasse' },
      { id: 'b', text: 'amicable settlement' },
      { id: 'c', text: 'outburst' },
      { id: 'd', text: 'ovation' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: '"Concessions from both sides" implies a mutually agreeable resolution, not a deadlock ("impasse").',
  },
  {
    section: 'VOCABULARY',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'HARD',
    content: 'Her argument was so ___ that even the skeptics in the room were persuaded.',
    options: [
      { id: 'a', text: 'cogent' },
      { id: 'b', text: 'trivial' },
      { id: 'c', text: 'ambiguous' },
      { id: 'd', text: 'redundant' },
    ],
    correctAnswer: { optionId: 'a' },
    explanation: '"Cogent" means clear and convincing — consistent with persuading skeptics.',
  },
];

const LISTENING: SeedQuestion[] = [
  {
    section: 'LISTENING',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    transcript:
      'A: "Excuse me, where is the nearest bus stop?" B: "It\'s just around the corner, next to the bakery."',
    content: 'Where is the bus stop?',
    options: [
      { id: 'a', text: 'Next to the bakery' },
      { id: 'b', text: 'Inside the bakery' },
      { id: 'c', text: 'Across from the station' },
      { id: 'd', text: 'Behind the pharmacy' },
    ],
    correctAnswer: { optionId: 'a' },
  },
  {
    section: 'LISTENING',
    type: 'TRUE_FALSE',
    difficulty: 'EASY',
    transcript: 'A: "Would you like tea or coffee?" B: "Coffee, please, no sugar."',
    content: 'True or false: The speaker asked for tea with sugar.',
    correctAnswer: { value: false },
  },
  {
    section: 'LISTENING',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'EASY',
    transcript:
      'A: "What time does the meeting start?" B: "It was moved from 9 to 10 because of the traffic."',
    content: 'What time does the meeting start now?',
    options: [
      { id: 'a', text: '9 o\'clock' },
      { id: 'b', text: '10 o\'clock' },
      { id: 'c', text: '11 o\'clock' },
      { id: 'd', text: 'It was cancelled' },
    ],
    correctAnswer: { optionId: 'b' },
  },
  {
    section: 'LISTENING',
    type: 'FILL_BLANK',
    difficulty: 'EASY',
    transcript: 'A: "Can you pass me the notebook?" B: "Sure, here you go."',
    content: 'What did speaker A ask for? Type the word you hear.',
    correctAnswer: { accepted: ['notebook'] },
  },
  {
    section: 'LISTENING',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    transcript:
      'A: "The flight to Chicago has been delayed by two hours." B: "That\'s a shame, I have a connecting flight at noon." A: "Don\'t worry, the new departure time still gives you enough time to connect."',
    content: 'What can we conclude?',
    options: [
      { id: 'a', text: 'The delay will not affect the connecting flight' },
      { id: 'b', text: 'The connecting flight has also been delayed' },
      { id: 'c', text: 'The passenger will miss the connection' },
      { id: 'd', text: 'The flight to Chicago was cancelled' },
    ],
    correctAnswer: { optionId: 'a' },
    explanation: 'Speaker A explicitly reassures that there is still enough time to connect.',
  },
  {
    section: 'LISTENING',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'MEDIUM',
    transcript:
      'A: "Did you finish the quarterly report?" B: "Almost — I just need the sales figures from Minh before I can submit it."',
    content: 'What is B still waiting for?',
    options: [
      { id: 'a', text: 'Approval from the manager' },
      { id: 'b', text: 'Sales figures from a colleague' },
      { id: 'c', text: 'A new deadline' },
      { id: 'd', text: 'A printed copy of the report' },
    ],
    correctAnswer: { optionId: 'b' },
  },
  {
    section: 'LISTENING',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'HARD',
    transcript:
      'A: "I thought the new policy would cut costs, but expenses actually went up." B: "That\'s not entirely fair to say — costs went up in shipping, but they dropped significantly in storage, so overall we did save money."',
    content: 'What is B\'s main point?',
    options: [
      { id: 'a', text: 'The new policy was a complete failure' },
      { id: 'b', text: 'Overall costs decreased despite one category rising' },
      { id: 'c', text: 'Storage costs increased along with shipping' },
      { id: 'd', text: 'The policy only affected shipping costs' },
    ],
    correctAnswer: { optionId: 'b' },
    explanation: 'B concedes shipping rose but argues the storage savings mean overall costs still fell.',
  },
  {
    section: 'LISTENING',
    type: 'MULTIPLE_CHOICE',
    difficulty: 'HARD',
    transcript:
      'A: "We could launch the product next month, but the marketing materials won\'t be ready." B: "Right, and launching without proper marketing has burned us before — remember last year?" A: "Fair point. Let\'s push it to the following month then."',
    content: 'What did the speakers decide?',
    options: [
      { id: 'a', text: 'Launch next month without marketing materials' },
      { id: 'b', text: 'Cancel the launch entirely' },
      { id: 'c', text: 'Delay the launch by one more month' },
      { id: 'd', text: 'Launch immediately' },
    ],
    correctAnswer: { optionId: 'c' },
  },
];

const ALL_QUESTIONS = [...GRAMMAR, ...VOCABULARY, ...LISTENING];

// This script matches existing rows by exact `content` text (see header
// comment) — LISTENING's `content` used to be the full dialogue-plus-question
// string, now split into `transcript` + a trimmed `content`. Without this
// one-time cleanup, re-running the seed would leave those old, pre-split
// rows behind as orphaned duplicates instead of updating them in place.
// Safe to delete outright: PlacementQuestion has no FK from PlacementAttempt
// (a Json id snapshot, not a relation — see the schema's own comment), so
// this cannot violate a constraint even for a row frozen into a past attempt.
const LEGACY_LISTENING_CONTENT = [
  'A: "Excuse me, where is the nearest bus stop?" B: "It\'s just around the corner, next to the bakery." Where is the bus stop?',
  'A: "Would you like tea or coffee?" B: "Coffee, please, no sugar." — The speaker asked for tea with sugar. True or false?',
  'A: "What time does the meeting start?" B: "It was moved from 9 to 10 because of the traffic." What time does the meeting start now?',
  'A: "Can you pass me the ___?" B: "Sure, here you go." (The word for a small book used for writing notes.)',
  'A: "The flight to Chicago has been delayed by two hours." B: "That\'s a shame, I have a connecting flight at noon." A: "Don\'t worry, the new departure time still gives you enough time to connect." What can we conclude?',
  'A: "Did you finish the quarterly report?" B: "Almost — I just need the sales figures from Minh before I can submit it." What is B still waiting for?',
  'A: "I thought the new policy would cut costs, but expenses actually went up." B: "That\'s not entirely fair to say — costs went up in shipping, but they dropped significantly in storage, so overall we did save money." What is B\'s main point?',
  'A: "We could launch the product next month, but the marketing materials won\'t be ready." B: "Right, and launching without proper marketing has burned us before — remember last year?" A: "Fair point. Let\'s push it to the following month then." What did the speakers decide?',
];

const main = async (): Promise<void> => {
  console.log('\nSeeding Placement Test question bank...\n');

  const { count: legacyRemoved } = await prisma.placementQuestion.deleteMany({
    where: { section: 'LISTENING', content: { in: LEGACY_LISTENING_CONTENT } },
  });
  if (legacyRemoved > 0) {
    console.log(`  Removed ${legacyRemoved} legacy pre-split Listening row(s).\n`);
  }

  ALL_QUESTIONS.forEach((question, index) => {
    const reason = validateQuestionContent({
      type: question.type,
      options: question.options ?? null,
      correctAnswer: question.correctAnswer,
    });
    if (reason) {
      throw new Error(`Question #${index + 1} ("${question.content}") is invalid: ${reason}`);
    }
  });

  let created = 0;
  let updated = 0;

  for (const question of ALL_QUESTIONS) {
    const existing = await prisma.placementQuestion.findFirst({
      where: { content: question.content },
    });

    if (existing) {
      await prisma.placementQuestion.update({
        where: { id: existing.id },
        data: {
          section: question.section,
          type: question.type,
          difficulty: question.difficulty,
          options: question.options ?? undefined,
          correctAnswer: question.correctAnswer as object,
          explanation: question.explanation,
          transcript: question.transcript,
          isPublished: true,
        },
      });
      updated += 1;
    } else {
      await prisma.placementQuestion.create({
        data: {
          section: question.section,
          type: question.type,
          difficulty: question.difficulty,
          content: question.content,
          options: question.options ?? undefined,
          correctAnswer: question.correctAnswer as object,
          explanation: question.explanation,
          transcript: question.transcript,
          isPublished: true,
        },
      });
      created += 1;
    }
  }

  console.log(
    `  ✓ ${created} created, ${updated} updated, ${ALL_QUESTIONS.length} total, all published.`,
  );

  const bySection = (section: CourseType) =>
    ALL_QUESTIONS.filter((q) => q.section === section).length;
  console.log(
    `    GRAMMAR: ${bySection('GRAMMAR')}, VOCABULARY: ${bySection('VOCABULARY')}, LISTENING: ${bySection('LISTENING')}`,
  );
  console.log('\nDone.\n');
};

main()
  .catch((error) => {
    console.error('\nSeed failed — no partial question was left behind for this run:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
