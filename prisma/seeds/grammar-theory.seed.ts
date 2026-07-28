import { PrismaClient } from '@prisma/client';

// Seed script for the Theory stage (Lesson.notes) of the two Grammar lessons
// whose notes did not match their own title:
//
//   - "Ngữ pháp TOEIC - Bài 1: Từ loại"        notes were entirely Present Simple
//   - "Ngữ pháp cơ bản - Bài 2: Động từ Tobe"  notes never mentioned am/is/are
//
// Both looked like placeholder text left behind, so a student read theory about
// one topic and then took a quiz on another. The replacement notes below teach
// exactly what each lesson's title, description and learningObjectives promise —
// and cover every point the seeded quiz asks about (prisma/seeds/grammar-quizzes.seed.ts).
//
// Idempotent: matches each lesson by its exact title and overwrites `notes`.
// Nothing else on the lesson is touched.
//
// AUTHORING CONVENTIONS (frontend: components/lesson/grammar/)
// `Lesson.notes` is one text column; the only structure it carries is the
// `## Heading` convention parseGrammarNotes recognises, and grammarBlocks.ts
// derives each card's TYPE from the heading text alone:
//
//   '## Concept ...'            -> concept card
//   '## Rule N — Title'         -> rule card, badge "Rule #N", title "Title"
//   '## Form and Structure'     -> formula card; body lines are `Label: value`
//   '## Examples'               -> example cards; `English — Tiếng Việt`
//   '## Common Mistakes'        -> mistake card; `Incorrect:` / `Correct:` pairs
//   '## Dấu hiệu ...'           -> signal-word chips, split on commas/newlines
//   '## Tips' / '## TOEIC Trap' -> tip / exam-trap card
//   '## Lesson Summary'         -> summary, always rendered last
//
// Two constraints the text below obeys deliberately:
//   - Markdown emphasis is NOT rendered (bodies are plain text nodes), so no
//     `**bold**` — it would print the asterisks. Emphasis is done with CAPS.
//   - Duplicate headings are concatenated into one card, so every heading in a
//     document is unique (hence '## Rule 1 — …', '## Rule 2 — …').
//
// Run with:  npm run seed:grammar-theory

const prisma = new PrismaClient();

interface SeedTheory {
  lessonTitle: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Ngữ pháp TOEIC — Bài 1: Từ loại
// Objectives: bản chất các từ loại · vị trí của N/V/Adj/Adv trong câu · mẹo làm
// bài từ loại trong đề thi. The Part 5 skill is positional, so the four rule
// cards are organised BY POSITION rather than by definition.
// ---------------------------------------------------------------------------
const partsOfSpeech: SeedTheory = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 1: Từ loại',
  notes: `## Concept Summary
Từ loại (parts of speech) là vai trò mà một từ đảm nhiệm trong câu, không phải nghĩa của từ đó. Trong TOEIC Part 5 và Part 6, câu hỏi từ loại luôn có cùng một hình dạng: bốn phương án là bốn biến thể của cùng một gốc từ (significant / significantly / significance / signify). Vì cả bốn đều "đúng nghĩa", bạn không thể chọn bằng cách dịch câu. Điều duy nhất quyết định đáp án là VỊ TRÍ của chỗ trống trong câu.

## Rule 1 — Danh từ (Noun)
Danh từ làm Chủ ngữ (S) hoặc Tân ngữ (O), và đứng ở ba vị trí quen thuộc:
Sau từ hạn định: a / an / the / this / my / our + N
Sau tính từ: the annual report
Sau giới từ: for / of / in / on / to + N
Dạng hay gặp nhất trong đề thi là "The + ___ + of ...", chỗ trống đó chắc chắn là danh từ.

## Rule 2 — Động từ (Verb)
Mỗi mệnh đề phải có đúng MỘT động từ chính đã chia thì.
Ngay sau chủ ngữ: The manager approved the plan.
Sau động từ khuyết thiếu (must, can, should, will) luôn là động từ nguyên thể, không chia -s: All employees must follow the rules.
Sau "to" cũng là động từ nguyên thể: We need to review the contract.

## Rule 3 — Tính từ (Adjective)
Tính từ bổ nghĩa cho danh từ, và chỉ đứng ở hai vị trí:
Ngay trước danh từ: a significant increase
Sau động từ nối (be, become, seem, remain, appear): The result is accurate.

## Rule 4 — Trạng từ (Adverb)
Trạng từ bổ nghĩa cho động từ, cho tính từ, cho trạng từ khác hoặc cho cả câu, nhưng không bao giờ bổ nghĩa cho danh từ.
Sau động từ: The team responded promptly.
Giữa trợ động từ và động từ chính: The company has recently announced a merger.
Trước tính từ: a highly successful campaign
Mẹo nhận biết: nếu xóa chỗ trống đi mà câu vẫn đủ ngữ pháp, chỗ trống đó gần như chắc chắn là trạng từ.

## Form and Structure
Vị trí danh từ: (the / a / my) + (adj) + N
Danh từ sau giới từ: prep + (the) + N
Vị trí tính từ: (a / the) + ADJ + N
Tính từ sau động từ nối: be / become / seem + ADJ
Vị trí trạng từ: S + V + ADV
Trạng từ bổ nghĩa tính từ: ADV + ADJ + N
Sau động từ khuyết thiếu: must / can / will + V (nguyên thể)

## Examples
The company reported a significant increase. — Công ty báo cáo mức tăng đáng kể. (a + tính từ + danh từ)
The technical team responded promptly. — Đội kỹ thuật đã phản hồi nhanh chóng. (động từ + trạng từ)
The installation of the system took three months. — Việc lắp đặt hệ thống mất ba tháng. (The + danh từ + of)
All employees must follow the safety guidelines. — Mọi nhân viên phải tuân thủ quy định an toàn. (must + động từ nguyên thể)
Ms. Tran is responsible for the preparation of the report. — Bà Trân phụ trách việc chuẩn bị báo cáo. (giới từ + the + danh từ)
It was a highly successful campaign. — Đó là một chiến dịch rất thành công. (trạng từ + tính từ + danh từ)

## Common Mistakes
Incorrect: The company reported a significantly increase.
Correct: The company reported a significant increase. (Giữa mạo từ và danh từ phải là tính từ.)
Incorrect: The technical team responded prompt.
Correct: The technical team responded promptly. (Bổ nghĩa cho động từ phải dùng trạng từ.)
Incorrect: All employees must follows the guidelines.
Correct: All employees must follow the guidelines. (Sau động từ khuyết thiếu luôn là động từ nguyên thể.)

## TOEIC Trap
Không phải từ nào kết thúc bằng -ly cũng là trạng từ: friendly, costly, likely, timely, orderly đều là TÍNH TỪ.
Nhiều từ có hình thức danh từ và động từ giống hệt nhau (increase, report, work, plan, order), nên phải nhìn vị trí chứ không nhìn mặt chữ.
Hai danh từ cùng gốc rất dễ chọn nhầm: applicant (người nộp đơn) và application (đơn xin việc). Hãy hỏi chỗ trống cần từ chỉ NGƯỜI hay chỉ SỰ VIỆC.

## Dấu hiệu nhận biết đuôi từ
Danh từ: -tion / -sion / -ment / -ance / -ence / -ity / -ness / -er / -or
Tính từ: -ous / -ive / -al / -ful / -less / -able / -ible / -ent / -ant
Trạng từ: -ly
Động từ: -ize / -ify / -en / -ate

## Tips
Ba bước xử lý một câu hỏi từ loại:
1. Đọc lướt để xác định câu đã có đủ S và V chưa.
2. Nhìn từ đứng ngay trước và ngay sau chỗ trống.
3. Chọn từ loại hợp với vị trí đó, rồi mới kiểm tra nghĩa.

## Lesson Summary
Câu hỏi từ loại không kiểm tra vốn từ mà kiểm tra khả năng đọc vị trí trong câu. Nhớ bốn vị trí lõi: sau mạo từ hoặc giới từ là danh từ; ngay trước danh từ là tính từ; bổ nghĩa cho động từ là trạng từ; sau động từ khuyết thiếu là động từ nguyên thể.`,
};

// ---------------------------------------------------------------------------
// Ngữ pháp cơ bản — Bài 2: Động từ Tobe
// Objectives: hiểu rõ động từ tobe · thì Present Simple · phân biệt động từ
// thường và động từ tobe. The third objective is the spine of the lesson, so
// every card contrasts the two verb types rather than teaching them separately.
//
// This is a Foundation lesson, so it carries concept / rule / formula /
// examples / mistakes / tips only — no TOEIC focus card and no exam trap
// (grammarBlocks.ts: those belong to TOEIC-oriented lessons and nothing else).
// ---------------------------------------------------------------------------
const toBeVerb: SeedTheory = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 2: Động từ Tobe',
  notes: `## Concept Summary
Trong tiếng Anh có hai loại động từ có thể làm động từ chính của câu: động từ to be (am / is / are) và động từ thường (work, study, like, watch...). To be mang nghĩa "là, thì, ở", dùng khi ta nói chủ ngữ LÀ ai, LÀ gì hoặc ĐANG Ở trạng thái nào. Động từ thường mô tả một HÀNH ĐỘNG mà chủ ngữ thực hiện. Điểm quan trọng nhất của bài học: một câu chỉ dùng MỘT trong hai loại đó làm động từ chính.

## Rule 1 — Chia động từ to be theo chủ ngữ
I dùng am.
He / She / It và danh từ số ít dùng is.
You / We / They và danh từ số nhiều dùng are.
Ví dụ: I am a student. / My sister is a nurse. / They are students.

## Rule 2 — Thì hiện tại đơn với động từ thường
Thì hiện tại đơn dùng cho thói quen, lịch trình và sự thật hiển nhiên.
I / You / We / They + động từ nguyên thể: They work in Hanoi.
He / She / It + động từ thêm -s hoặc -es: She works in Hanoi.
Thêm -es sau -o, -s, -x, -ch, -sh (goes, watches); đổi -y thành -ies khi trước -y là phụ âm (study thành studies).

## Rule 3 — Phủ định và câu hỏi: hai loại động từ, hai cách làm
Với to be, thêm "not" ngay sau to be, và đảo to be lên trước chủ ngữ để hỏi:
He is not (isn't) at home. Câu hỏi: Is he at home?
Với động từ thường, mượn trợ động từ do / does:
She does not (doesn't) work here. Câu hỏi: Does she work here?
Không bao giờ dùng do/does với to be, và không bao giờ bỏ do/does với động từ thường.

## Form and Structure
Khẳng định (to be): S + am / is / are + danh từ / tính từ
Phủ định (to be): S + am / is / are + not + ...
Nghi vấn (to be): Am / Is / Are + S + ...?
Khẳng định (động từ thường): S + V (thêm -s/-es với He, She, It)
Phủ định (động từ thường): S + do / does + not + V (nguyên thể)
Nghi vấn (động từ thường): Do / Does + S + V (nguyên thể) ...?

## Examples
I am a student. — Tôi là học sinh.
My sister is a nurse. — Chị tôi là y tá.
They are students. — Họ là học sinh.
He isn't at home right now. — Bây giờ anh ấy không có ở nhà.
Is she a doctor? — Cô ấy có phải bác sĩ không?
She works at a bank. — Cô ấy làm việc ở ngân hàng.
Do you like coffee? — Bạn có thích cà phê không?
They don't watch TV in the morning. — Họ không xem TV vào buổi sáng.

## Common Mistakes
Incorrect: She is works at a bank.
Correct: She works at a bank. (Một câu chỉ có một động từ chính: đã có "works" thì không dùng thêm "is".)
Incorrect: They is students.
Correct: They are students. ("They" là số nhiều nên dùng "are".)
Incorrect: Are you like coffee?
Correct: Do you like coffee? ("like" là động từ thường nên câu hỏi phải mượn "do/does".)
Incorrect: He doesn't at home.
Correct: He isn't at home. (Vị ngữ là to be nên phủ định bằng "is not", không dùng "doesn't".)

## Dấu hiệu nhận biết thì hiện tại đơn
always, usually, often, sometimes, rarely, never, every day, every morning, on Mondays, twice a week

## Tips
Trước khi chọn động từ, hãy hỏi: câu này nói chủ ngữ LÀ gì (dùng to be) hay LÀM gì (dùng động từ thường)?
Chỉ một trong hai được làm động từ chính, nên thấy "is works" hay "are like" là biết ngay câu đó sai.

## Lesson Summary
Dùng to be (am / is / are) khi nói chủ ngữ LÀ ai, LÀ gì hoặc Ở trạng thái nào; dùng động từ thường khi nói chủ ngữ LÀM gì. To be tự thêm "not" để phủ định và tự đảo lên đầu để hỏi, còn động từ thường phải mượn do/does. Không bao giờ dùng cả hai làm động từ chính trong cùng một câu.`,
};

const SEEDS: SeedTheory[] = [partsOfSpeech, toBeVerb];

// A local guard for the authoring conventions above. The frontend parser is the
// real authority, but it lives in another package — this catches the mistakes
// that would silently degrade a card (a formula line with no label, an example
// with no translation, a mistake line the pairer would render as an unanswered
// error) before anything is written.
const validateNotes = (seed: SeedTheory): void => {
  const fail = (message: string): never => {
    throw new Error(`[${seed.lessonTitle}] ${message}`);
  };

  const headings = seed.notes
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());

  if (!headings.length)
    fail('no "## " headings — the whole text would render as one plain block');
  if (new Set(headings).size !== headings.length) {
    fail('duplicate heading — those sections would be merged into one card');
  }
  if (seed.notes.includes('**')) {
    fail('markdown emphasis is not rendered; the asterisks would be printed');
  }

  const bodyOf = (heading: string): string[] => {
    const start = seed.notes.indexOf(`## ${heading}`);
    if (start === -1) return []; // an absent section is author choice, not an error
    const rest = seed.notes.slice(start).split('\n').slice(1);
    const end = rest.findIndex((line) => line.startsWith('## '));
    return (end === -1 ? rest : rest.slice(0, end))
      .map((l) => l.trim())
      .filter(Boolean);
  };

  bodyOf('Form and Structure').forEach((line) => {
    const label = line.split(':')[0];
    if (!line.includes(':'))
      fail(`formula line has no "Label: value" shape: ${line}`);
    if (label.length > 40) fail(`formula label longer than 40 chars: ${label}`);
  });

  bodyOf('Examples').forEach((line) => {
    if (!/\s—\s/.test(line))
      fail(`example has no " — " translation separator: ${line}`);
  });

  bodyOf('Common Mistakes').forEach((line) => {
    if (!/^(Incorrect|Correct):/.test(line)) {
      fail(`mistake line must start with "Incorrect:" or "Correct:": ${line}`);
    }
  });
};

const seedOne = async (seed: SeedTheory): Promise<void> => {
  const lesson = await prisma.lesson.findFirst({
    where: { title: seed.lessonTitle },
    select: { id: true, title: true },
  });

  if (!lesson) {
    throw new Error(
      `Lesson not found: "${seed.lessonTitle}". Its notes were left untouched.`,
    );
  }

  await prisma.lesson.update({
    where: { id: lesson.id },
    data: { notes: seed.notes },
  });

  const blocks = seed.notes
    .split('\n')
    .filter((line) => line.startsWith('## ')).length;
  console.log(`  ✓ ${lesson.title}\n      ${blocks} theory blocks written`);
};

const main = async (): Promise<void> => {
  console.log('\nSeeding Grammar lesson theory (Lesson.notes)...\n');
  SEEDS.forEach(validateNotes);
  for (const seed of SEEDS) {
    await seedOne(seed);
  }
  console.log('\nDone.\n');
};

main()
  .catch((error) => {
    console.error('\nSeed failed — no lesson notes were changed:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
