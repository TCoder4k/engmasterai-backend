import {
  CefrLevel,
  ListeningMediaProvider,
  ListeningMediaType,
  ListeningMode,
  PrismaClient,
} from '@prisma/client';

// Sprint 11 — migrates the five client-side Listening recordings into the
// database.
//
// WHAT THIS REPLACES. Until now Listening content lived in the FRONTEND, in
// `components/practice/listening/listeningContent.ts` — a versioned seed module
// (`LISTENING_CONTENT_VERSION = 'seed-v1'`) whose own header said a real
// backend transcript model was "expected to replace this file entirely, not
// extend it indefinitely". This is that replacement.
//
// >>> EVERYTHING IS CREATED AS A DRAFT, AND THAT IS THE POINT <<<
//
// Both the categories and the recordings land with `isPublished: false`, and
// `mediaUrl` is deliberately EMPTY. These five transcripts are self-authored
// and safe to keep, but they have never had audio or video attached: the
// original module played them through the browser's speech synthesiser, and
// `services/tts.ts` states plainly that TTS output "is a listening-practice
// aid, never a canonical pronunciation reference". There is no legally cleared
// recording to point at yet.
//
// So publishing is BLOCKED BY DESIGN rather than by omission — an empty
// mediaUrl fails validateContentForPublish with "add a media URL". An admin
// attaches a real recording, checks the timings, and publishes. Nothing here
// puts content in front of a student.
//
// TIMESTAMPS ARE DERIVED, NOT INVENTED. The source module stored a
// `durationSeconds` per sentence and no absolute positions, so each segment
// starts where the previous one ended. Once real media is attached these will
// need checking against it — which is exactly what the publish-time overlap
// and duration rules are there to force.
//
// Idempotent: categories are matched by name and recordings by title, both
// create-or-reuse. Re-running adds nothing and overwrites nothing, the same
// contract the vocabulary importer follows.
//
// Run with:  npm run seed:listening

const prisma = new PrismaClient();

/** The five categories approved for Sprint 11, in display order. */
const CATEGORIES: { name: string; nameVi: string }[] = [
  { name: 'Business', nameVi: 'Kinh doanh' },
  { name: 'Travel', nameVi: 'Du lịch' },
  { name: 'TOEIC', nameVi: 'TOEIC' },
  { name: 'Daily Conversations', nameVi: 'Hội thoại hằng ngày' },
  { name: 'Job Interview', nameVi: 'Phỏng vấn xin việc' },
];

interface SeedSegment {
  textEn: string;
  textVi: string;
  durationSeconds: number;
}

interface SeedContent {
  title: string;
  description: string;
  categoryName: string;
  level: CefrLevel;
  segments: SeedSegment[];
}

// Copied verbatim from the frontend seed module. Every sentence was written
// for this app — never taken from ETS or any commercial TOEIC material, which
// was a locked rule of the original content decision and stays one here.
const CONTENTS: SeedContent[] = [
  {
    title: 'Office Relocation Notice',
    description: 'A short internal briefing about an office move.',
    categoryName: 'Business',
    level: CefrLevel.B2,
    segments: [
      {
        textEn: 'Good morning everyone, thank you for joining this short briefing.',
        textVi: 'Chào buổi sáng mọi người, cảm ơn các bạn đã tham dự buổi họp ngắn này.',
        durationSeconds: 4,
      },
      {
        textEn: 'Starting next Monday, our office will move to the third floor.',
        textVi: 'Bắt đầu từ thứ Hai tới, văn phòng của chúng ta sẽ chuyển lên tầng ba.',
        durationSeconds: 5,
      },
      {
        textEn: 'Please pack your personal belongings into the boxes provided by Friday.',
        textVi: 'Vui lòng đóng gói đồ dùng cá nhân vào các thùng được cung cấp trước thứ Sáu.',
        durationSeconds: 5,
      },
      {
        textEn: 'The new workstations already have updated network cables installed.',
        textVi: 'Các bàn làm việc mới đã được lắp sẵn dây mạng cập nhật.',
        durationSeconds: 5,
      },
      {
        textEn: 'If you have any questions, please contact the facilities team directly.',
        textVi: 'Nếu có thắc mắc, vui lòng liên hệ trực tiếp với đội ngũ quản lý cơ sở vật chất.',
        durationSeconds: 5,
      },
    ],
  },
  {
    title: 'Flight Delay Announcement',
    description: 'An airport gate announcement about a short delay.',
    categoryName: 'Travel',
    level: CefrLevel.B1,
    segments: [
      {
        textEn: 'Attention passengers, we regret to announce a short delay.',
        textVi: 'Kính thưa quý hành khách, chúng tôi rất tiếc phải thông báo về một sự chậm trễ ngắn.',
        durationSeconds: 4,
      },
      {
        textEn: 'Flight two-one-four to Chicago will now depart at four fifteen.',
        textVi: 'Chuyến bay hai một bốn đi Chicago giờ sẽ khởi hành lúc bốn giờ mười lăm.',
        durationSeconds: 5,
      },
      {
        textEn: 'This delay is due to a temporary technical inspection.',
        textVi: 'Sự chậm trễ này là do việc kiểm tra kỹ thuật tạm thời.',
        durationSeconds: 4,
      },
      {
        textEn: 'Passengers may wait comfortably near gate twelve until boarding.',
        textVi: 'Hành khách có thể chờ thoải mái gần cổng số mười hai cho đến khi lên máy bay.',
        durationSeconds: 5,
      },
      {
        textEn: 'We apologize for any inconvenience this may have caused you.',
        textVi: 'Chúng tôi xin lỗi vì sự bất tiện này có thể đã gây ra cho quý khách.',
        durationSeconds: 5,
      },
    ],
  },
  {
    title: 'Quarterly Sales Update',
    description: 'A manager summarizes quarterly revenue and next steps.',
    categoryName: 'TOEIC',
    level: CefrLevel.B2,
    segments: [
      {
        textEn: 'Let me walk you through the highlights of this quarter.',
        textVi: 'Hãy để tôi trình bày những điểm nổi bật của quý này.',
        durationSeconds: 4,
      },
      {
        textEn: 'Overall revenue increased by twelve percent compared to last year.',
        textVi: 'Doanh thu tổng thể tăng mười hai phần trăm so với năm ngoái.',
        durationSeconds: 5,
      },
      {
        textEn: 'Our online store performed particularly well during the holiday season.',
        textVi: 'Cửa hàng trực tuyến của chúng ta hoạt động đặc biệt tốt trong mùa lễ hội.',
        durationSeconds: 5,
      },
      {
        textEn: 'However, shipping costs also rose due to higher fuel prices.',
        textVi: 'Tuy nhiên, chi phí vận chuyển cũng tăng do giá nhiên liệu cao hơn.',
        durationSeconds: 5,
      },
      {
        textEn: 'Next quarter, we plan to expand into two new regional markets.',
        textVi: 'Quý tới, chúng tôi dự định mở rộng sang hai thị trường khu vực mới.',
        durationSeconds: 5,
      },
    ],
  },
  {
    title: 'Ordering at a Café',
    description: 'A simple everyday conversation about ordering drinks.',
    categoryName: 'Daily Conversations',
    level: CefrLevel.A2,
    segments: [
      {
        textEn: 'Hi there, what can I get for you today?',
        textVi: 'Xin chào, hôm nay bạn muốn dùng gì?',
        durationSeconds: 3,
      },
      {
        textEn: 'I would like a small coffee with milk, please.',
        textVi: 'Cho tôi một ly cà phê nhỏ với sữa nhé.',
        durationSeconds: 4,
      },
      {
        textEn: 'Would you like anything to eat with that?',
        textVi: 'Bạn có muốn dùng gì ăn kèm không?',
        durationSeconds: 3,
      },
      {
        textEn: 'Yes, one blueberry muffin to go, please.',
        textVi: 'Vâng, cho tôi một bánh muffin việt quất mang đi.',
        durationSeconds: 4,
      },
      {
        textEn: 'That will be six dollars and fifty cents in total.',
        textVi: 'Tổng cộng của bạn là sáu đô la năm mươi xu.',
        durationSeconds: 4,
      },
    ],
  },
  {
    title: 'Job Interview Introduction',
    description: 'The opening minutes of a friendly job interview.',
    categoryName: 'Job Interview',
    level: CefrLevel.B1,
    segments: [
      {
        textEn: 'Thank you for coming in today, please have a seat.',
        textVi: 'Cảm ơn bạn đã đến hôm nay, mời bạn ngồi.',
        durationSeconds: 4,
      },
      {
        textEn: 'Could you start by telling us a little about yourself?',
        textVi: 'Bạn có thể bắt đầu bằng việc giới thiệu đôi chút về bản thân không?',
        durationSeconds: 4,
      },
      {
        textEn: 'I have worked in customer service for almost three years.',
        textVi: 'Tôi đã làm việc trong lĩnh vực chăm sóc khách hàng gần ba năm.',
        durationSeconds: 4,
      },
      {
        textEn: 'What would you say is your greatest professional strength?',
        textVi: 'Bạn nghĩ điểm mạnh lớn nhất trong công việc của mình là gì?',
        durationSeconds: 4,
      },
      {
        textEn: 'I stay calm under pressure and communicate clearly with customers.',
        textVi: 'Tôi giữ bình tĩnh khi gặp áp lực và giao tiếp rõ ràng với khách hàng.',
        durationSeconds: 5,
      },
    ],
  },
];

/**
 * The normalizer, DUPLICATED HERE ON PURPOSE.
 *
 * A seed script is a standalone `ts-node` entry point outside the Nest
 * dependency graph, and `prisma/` importing from `src/` would tie schema
 * tooling to application code. It is eight lines and it is pinned by
 * text-normalization.spec.ts on the service side.
 *
 * IF THAT FILE'S RULES CHANGE, THIS MUST CHANGE WITH IT — or re-seeding would
 * write reference text normalized by an older standard than the running
 * application uses.
 */
const normalizeReferenceText = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼʹ՚＇]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/(?<![\p{L}\p{N}])['-]|['-](?![\p{L}\p{N}])/gu, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const seedCategories = async (): Promise<Map<string, string>> => {
  const idsByName = new Map<string, string>();

  for (const [index, category] of CATEGORIES.entries()) {
    const existing = await prisma.listeningCategory.findFirst({
      where: { name: category.name },
      select: { id: true },
    });

    if (existing) {
      idsByName.set(category.name, existing.id);
      console.log(`  · ${category.name} — already present, left untouched`);
      continue;
    }

    const created = await prisma.listeningCategory.create({
      data: {
        name: category.name,
        nameVi: category.nameVi,
        orderIndex: index,
        // DRAFT. Nothing this script writes is student-visible.
        isPublished: false,
      },
      select: { id: true },
    });

    idsByName.set(category.name, created.id);
    console.log(`  ✓ ${category.name} (${category.nameVi}) — created as draft`);
  }

  return idsByName;
};

const seedContent = async (
  content: SeedContent,
  categoryId: string,
): Promise<void> => {
  const existing = await prisma.listeningContent.findFirst({
    where: { title: content.title },
    select: { id: true },
  });

  if (existing) {
    console.log(`  · ${content.title} — already present, left untouched`);
    return;
  }

  // Cumulative positions: each sentence starts where the previous one ended.
  let cursorMs = 0;
  const segments = content.segments.map((segment, index) => {
    const startTimeMs = cursorMs;
    const endTimeMs = startTimeMs + segment.durationSeconds * 1000;
    cursorMs = endTimeMs;

    return {
      orderIndex: index,
      text: segment.textEn,
      normalizedText: normalizeReferenceText(segment.textEn),
      translationVi: segment.textVi,
      startTimeMs,
      endTimeMs,
    };
  });

  await prisma.listeningContent.create({
    data: {
      categoryId,
      title: content.title,
      description: content.description,
      level: content.level,
      // EMPTY ON PURPOSE — see the header. This is what blocks publication
      // until a real, cleared recording is attached by an admin.
      mediaUrl: '',
      mediaType: ListeningMediaType.AUDIO,
      mediaProvider: ListeningMediaProvider.EXTERNAL_URL,
      durationMs: cursorMs,
      // Dictation only. Shadowing is not enabled on migrated content: without
      // real audio there is no model pronunciation to shadow, and enabling a
      // mode that cannot be practised honestly is worse than omitting it.
      supportedModes: [ListeningMode.DICTATION],
      isPublished: false,
      segments: { create: segments },
    },
  });

  console.log(
    `  ✓ ${content.title} — created as draft, ${segments.length} segments, no media`,
  );
};

const main = async (): Promise<void> => {
  console.log('\nSeeding Listening categories and content (all as drafts)...\n');

  console.log('Categories:');
  const categoryIds = await seedCategories();

  console.log('\nContent:');
  for (const content of CONTENTS) {
    const categoryId = categoryIds.get(content.categoryName);
    if (!categoryId) {
      throw new Error(
        `No category id for "${content.categoryName}" — categories must be seeded first.`,
      );
    }
    await seedContent(content, categoryId);
  }

  console.log(
    '\nDone. Everything is a DRAFT with no media attached, so the student ' +
      'catalog stays empty.\nAttach cleared media, verify the timings, then ' +
      'publish the category and the content.\n',
  );
};

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
