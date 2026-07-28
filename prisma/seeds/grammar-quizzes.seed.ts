import { Prisma, PrismaClient, QuestionType } from '@prisma/client';
import { validateQuestionContent } from '../../src/lesson/quiz/grade-question';

// Seed script for the four published Grammar lessons' quizzes.
//
// Idempotent: matches each lesson by its exact title, reuses (never
// recreates) its QUIZ LessonTask so existing LessonTaskProgress rows keep
// their foreign key, then replaces that task's question list wholesale.
// Re-running produces the same result.
//
// Every question is validated through the API's own
// validateQuestionContent() before any write, so this script cannot seed
// content the real grader would reject (a correctAnswer that doesn't match
// its type, an optionId that isn't among its own options, and so on).
//
// Run with:  npm run seed:grammar-quizzes

const prisma = new PrismaClient();

interface SeedQuestion {
  type: QuestionType;
  content: string;
  options?: { id: string; text: string }[];
  correctAnswer: unknown;
  explanation: string;
}

interface SeedQuiz {
  lessonTitle: string;
  passingScorePercent: number;
  questions: SeedQuestion[];
}

// ---------------------------------------------------------------------------
// 1. Ngữ pháp cơ bản — Bài 1: Cấu trúc câu Tiếng Anh
//    Source of truth: the lesson's own notes — S/V/O/C/A, the five sentence
//    patterns, the two Common Mistakes, and the TOEIC tip ("find V first").
// ---------------------------------------------------------------------------
const sentenceStructure: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 1: Cấu trúc câu Tiếng Anh',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Câu "They made him happy." thuộc cấu trúc câu cơ bản nào trong 5 cấu trúc đã học?',
      options: [
        { id: 'svo', text: 'S + V + O' },
        { id: 'svc', text: 'S + V + C' },
        { id: 'svoo', text: 'S + V + O1 + O2' },
        { id: 'svoc', text: 'S + V + O + C' },
      ],
      correctAnswer: { optionId: 'svoc' },
      explanation:
        '"him" là tân ngữ (O) và "happy" là bổ ngữ mô tả chính tân ngữ đó (C), nên câu theo cấu trúc S + V + O + C. Phân biệt với S + V + O1 + O2, trong đó cả hai đều là tân ngữ (ví dụ: She gave me a book).',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Trong câu "He became a manager.", cụm "a manager" đóng vai trò thành phần nào?',
      options: [
        { id: 'o', text: 'Tân ngữ (Object - O)' },
        { id: 'c', text: 'Bổ ngữ (Complement - C)' },
        { id: 'a', text: 'Trạng ngữ (Adverbial - A)' },
        { id: 's', text: 'Chủ ngữ (Subject - S)' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"become" là động từ nối (linking verb). Sau động từ nối là Bổ ngữ (C) mô tả lại chủ ngữ, chứ không phải Tân ngữ. Ở đây "a manager" chính là "he", nên nó là C.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào sau đây SAI về vị trí của trạng ngữ?',
      options: [
        { id: 'w', text: 'I very like this course.' },
        { id: 'a', text: 'I like this course very much.' },
        { id: 'b', text: 'She sleeps early every night.' },
        { id: 'c', text: 'The teacher explains the lesson clearly.' },
      ],
      correctAnswer: { optionId: 'w' },
      explanation:
        'Không đặt "very" trực tiếp trước động từ thường. Cách viết đúng là "I like this course very much." — trạng ngữ chỉ mức độ đứng cuối câu.',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Một câu trần thuật hoàn chỉnh trong tiếng Anh tối thiểu phải có Chủ ngữ (S) và Động từ chính (V).',
      correctAnswer: { value: true },
      explanation:
        'Đúng. S + V là cấu trúc tối thiểu (ví dụ: "She sleeps."). Các thành phần O, C, A chỉ xuất hiện tùy theo loại động từ. Vì vậy "Sleeps she early every night." sai do thiếu/sai vị trí chủ ngữ.',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trong câu "She gave me a book.", từ "me" là Bổ ngữ (C) của câu.',
      correctAnswer: { value: false },
      explanation:
        'Sai. "me" là Tân ngữ gián tiếp (O1) và "a book" là Tân ngữ trực tiếp (O2) — câu theo cấu trúc S + V + O1 + O2. Bổ ngữ (C) chỉ xuất hiện sau động từ nối hoặc sau tân ngữ trong cấu trúc S + V + O + C.',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu theo cấu trúc S + V + C với động từ nối "taste" ở thì hiện tại đơn: "The soup _____ delicious."',
      correctAnswer: { accepted: ['tastes'] },
      explanation:
        '"The soup" là chủ ngữ số ít nên động từ thêm -s: "tastes". "taste" ở đây là động từ nối, theo sau là bổ ngữ "delicious" mô tả chủ ngữ.',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp thành câu đúng theo cấu trúc S + V + O + A (Chủ ngữ + Động từ + Tân ngữ + Trạng ngữ):',
      options: [
        { id: 'w1', text: 'The manager' },
        { id: 'w2', text: 'approved' },
        { id: 'w3', text: 'the proposal' },
        { id: 'w4', text: 'yesterday' },
      ],
      correctAnswer: { orderedOptionIds: ['w1', 'w2', 'w3', 'w4'] },
      explanation:
        'S (The manager) + V (approved) + O (the proposal) + A (yesterday). Trạng ngữ chỉ thời gian đứng cuối câu, không chen giữa động từ và tân ngữ.',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp thành câu đúng theo cấu trúc S + V + O1 + O2 (Tân ngữ gián tiếp trước, Tân ngữ trực tiếp sau):',
      options: [
        { id: 'x1', text: 'My teacher' },
        { id: 'x2', text: 'sent' },
        { id: 'x3', text: 'me' },
        { id: 'x4', text: 'an email' },
      ],
      correctAnswer: { orderedOptionIds: ['x1', 'x2', 'x3', 'x4'] },
      explanation:
        'S (My teacher) + V (sent) + O1 (me — tân ngữ gián tiếp, chỉ người nhận) + O2 (an email — tân ngữ trực tiếp, chỉ vật). Khi không có giới từ "to", tân ngữ gián tiếp luôn đứng trước.',
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Ngữ pháp cơ bản — Bài 2: Động từ Tobe
//    Source of truth: the lesson TITLE + description ("Hiểu rõ về động từ
//    tobe / thì Present Simple / phân biệt động từ thường và động từ tobe").
//    NOTE: this lesson's `notes` field currently contains generic Present
//    Simple content with no am/is/are at all — see the report accompanying
//    this seed. Questions follow the stated topic, not the placeholder notes.
// ---------------------------------------------------------------------------
const toBeVerb: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 2: Động từ Tobe',
  passingScorePercent: 70,
  questions: [
    {
      type: 'FILL_BLANK',
      content:
        'Điền động từ to be ở thì hiện tại đơn: "My sister _____ a nurse."',
      correctAnswer: { accepted: ['is'] },
      explanation:
        '"My sister" là chủ ngữ số ít ngôi thứ ba, nên dùng "is". Ghi nhớ: I → am; He/She/It và danh từ số ít → is; You/We/They và danh từ số nhiều → are.',
    },
    {
      type: 'FILL_BLANK',
      content: 'Điền động từ to be ở thì hiện tại đơn: "They _____ students."',
      correctAnswer: { accepted: ['are'] },
      explanation:
        '"They" là đại từ số nhiều nên dùng "are". Đây là lỗi sai phổ biến khi học viên dùng "is" cho mọi chủ ngữ.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào sau đây SAI ngữ pháp?',
      options: [
        { id: 'w', text: 'She is works at a bank.' },
        { id: 'a', text: 'She works at a bank.' },
        { id: 'b', text: 'She is a bank clerk.' },
        { id: 'c', text: 'She is busy today.' },
      ],
      correctAnswer: { optionId: 'w' },
      explanation:
        'Đây là lỗi phân biệt động từ thường và động từ to be: một câu chỉ dùng MỘT trong hai. "works" đã là động từ chính rồi nên không cần "is". Viết đúng: "She works at a bank." hoặc "She is a bank clerk."',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng phủ định đúng: "He _____ at home right now."',
      options: [
        { id: 'a', text: "isn't" },
        { id: 'b', text: "doesn't" },
        { id: 'c', text: "don't" },
        { id: 'd', text: "aren't" },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Với động từ to be, phủ định được tạo bằng cách thêm "not" ngay sau to be (is not → isn\'t). Không dùng trợ động từ do/does với to be — "doesn\'t" chỉ dùng với động từ thường.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn câu hỏi đúng để hỏi "Bạn có thích cà phê không?"',
      options: [
        { id: 'a', text: 'Do you like coffee?' },
        { id: 'b', text: 'Are you like coffee?' },
        { id: 'c', text: 'Are you liking coffee?' },
        { id: 'd', text: 'Is you like coffee?' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"like" là động từ thường nên câu hỏi dùng trợ động từ Do/Does. Chỉ khi vị ngữ là to be (Are you ready?) mới đảo to be lên đầu. Đây chính là điểm phân biệt động từ thường và to be.',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Với chủ ngữ "I", động từ to be ở thì hiện tại đơn là "am".',
      correctAnswer: { value: true },
      explanation:
        'Đúng. "I am" là dạng duy nhất dùng "am". Lưu ý dạng phủ định rút gọn thông dụng là "I\'m not" (không có dạng "amn\'t").',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Câu "Are you a student?" và "Do you study English?" đều đúng ngữ pháp.',
      correctAnswer: { value: true },
      explanation:
        'Đúng, vì mỗi câu dùng đúng loại động từ của nó: câu đầu có vị ngữ là to be nên đảo "are" lên trước; câu sau có động từ thường "study" nên cần trợ động từ "do".',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu hỏi Yes/No đúng với động từ to be:',
      options: [
        { id: 'y1', text: 'Is' },
        { id: 'y2', text: 'she' },
        { id: 'y3', text: 'a doctor' },
        { id: 'y4', text: '?' },
      ],
      correctAnswer: { orderedOptionIds: ['y1', 'y2', 'y3', 'y4'] },
      explanation:
        'Với to be, câu hỏi Yes/No được tạo bằng cách đảo to be lên trước chủ ngữ: Is + S + phần còn lại? → "Is she a doctor?"',
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Ngữ pháp TOEIC — Bài 1: Từ loại
//    Source of truth: the lesson TITLE + description ("bản chất và vị trí của
//    các từ loại trong câu TOEIC"). This is the core Part 5 word-form skill:
//    choose the part of speech from its POSITION in the sentence.
//    NOTE: this lesson's `notes` field currently contains Present Simple
//    placeholder text unrelated to its title — see the accompanying report.
// ---------------------------------------------------------------------------
const partsOfSpeech: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 1: Từ loại',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The company reported a _____ increase in quarterly profits.',
      options: [
        { id: 'a', text: 'significant' },
        { id: 'b', text: 'significantly' },
        { id: 'c', text: 'significance' },
        { id: 'd', text: 'signify' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Vị trí giữa mạo từ "a" và danh từ "increase" là vị trí của TÍNH TỪ. → "a significant increase". Đây là dạng câu hỏi từ loại kinh điển của TOEIC Part 5: xác định vị trí trống trước, rồi chọn từ loại tương ứng.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The technical team responded _____ to the customer complaint.',
      options: [
        { id: 'a', text: 'prompt' },
        { id: 'b', text: 'promptly' },
        { id: 'c', text: 'promptness' },
        { id: 'd', text: 'prompted' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Câu đã đủ S (The technical team) + V (responded). Chỗ trống bổ nghĩa cho ĐỘNG TỪ nên phải là TRẠNG TỪ → "promptly". Mẹo: nếu bỏ chỗ trống đi mà câu vẫn đủ nghĩa, đó gần như chắc chắn là trạng từ.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The _____ of the new payroll system took three months.',
      options: [
        { id: 'a', text: 'install' },
        { id: 'b', text: 'installed' },
        { id: 'c', text: 'installation' },
        { id: 'd', text: 'installing' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Sau mạo từ "The" và trước giới từ "of" là vị trí của DANH TỪ → "installation". Cấu trúc "The + ___ + of" là một dấu hiệu nhận biết danh từ rất thường gặp trong Part 5.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'All employees must _____ the updated safety guidelines.',
      options: [
        { id: 'a', text: 'follow' },
        { id: 'b', text: 'follows' },
        { id: 'c', text: 'following' },
        { id: 'd', text: 'follower' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Sau động từ khuyết thiếu (must, can, should, will…) luôn là ĐỘNG TỪ NGUYÊN THỂ không "to" → "follow". Không chia -s sau modal, dù chủ ngữ là gì.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Ms. Tran is responsible for the _____ of the annual budget report.',
      options: [
        { id: 'a', text: 'prepare' },
        { id: 'b', text: 'prepared' },
        { id: 'c', text: 'preparation' },
        { id: 'd', text: 'preparatory' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Sau GIỚI TỪ ("for") và mạo từ "the" phải là DANH TỪ → "preparation". Quy tắc cốt lõi: giới từ + danh từ (hoặc V-ing), không bao giờ + động từ nguyên thể.',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trong câu tiếng Anh, tính từ thường đứng trước danh từ mà nó bổ nghĩa, còn trạng từ bổ nghĩa cho động từ, tính từ hoặc cả câu.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Đây là nguyên tắc nền tảng để làm câu hỏi từ loại: xác định chỗ trống đứng cạnh cái gì (danh từ → chọn tính từ; động từ/tính từ → chọn trạng từ).',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền đuôi từ (suffix) là dấu hiệu nhận biết phổ biến nhất của TRẠNG TỪ trong tiếng Anh (chỉ viết phần đuôi, ví dụ dạng "-xx"):',
      correctAnswer: { accepted: ['-ly', 'ly'] },
      explanation:
        'Đuôi "-ly" là dấu hiệu trạng từ phổ biến nhất (quickly, promptly, significantly). Lưu ý ngoại lệ: một số từ kết thúc bằng -ly lại là tính từ (friendly, costly, likely), nên vẫn phải xét vị trí trong câu.',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp thành cụm danh từ đúng trật tự từ loại (mạo từ → trạng từ → tính từ → danh từ):',
      options: [
        { id: 'p1', text: 'a' },
        { id: 'p2', text: 'highly' },
        { id: 'p3', text: 'successful' },
        { id: 'p4', text: 'campaign' },
      ],
      correctAnswer: { orderedOptionIds: ['p1', 'p2', 'p3', 'p4'] },
      explanation:
        '"a highly successful campaign": trạng từ "highly" bổ nghĩa cho tính từ "successful", và cả cụm bổ nghĩa cho danh từ "campaign". Trật tự này xuất hiện rất nhiều trong Part 5 và Part 6.',
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Ngữ pháp TOEIC — Bài 2: Đại từ
//    Source of truth: the lesson's own notes (subject vs object pronouns,
//    the "Him loves English" Common Mistake) extended to the full pronoun
//    table the title promises ("phân loại và vị trí").
// ---------------------------------------------------------------------------
const pronouns: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 2: Đại từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ loves English and studies it every evening.',
      options: [
        { id: 'a', text: 'He' },
        { id: 'b', text: 'Him' },
        { id: 'c', text: 'His' },
        { id: 'd', text: 'Himself' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Vị trí đầu câu, đứng trước động từ "loves" là vị trí của ĐẠI TỪ CHỦ NGỮ → "He". "Him loves English" là lỗi sai điển hình vì dùng đại từ tân ngữ ở vị trí chủ ngữ.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'John forgot his notebook, so I lent _____ mine.',
      options: [
        { id: 'a', text: 'he' },
        { id: 'b', text: 'him' },
        { id: 'c', text: 'his' },
        { id: 'd', text: 'himself' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Sau động từ "lent" là vị trí của ĐẠI TỪ TÂN NGỮ → "him". Quy tắc: đại từ tân ngữ (me, you, him, her, us, them) đứng sau động từ hoặc sau giới từ.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ department will host the training session next Monday.',
      options: [
        { id: 'a', text: 'They' },
        { id: 'b', text: 'Them' },
        { id: 'c', text: 'Their' },
        { id: 'd', text: 'Theirs' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Ngay trước một DANH TỪ ("department") phải là TÍNH TỪ SỞ HỮU → "Their". Phân biệt: tính từ sở hữu (their) luôn đi kèm danh từ; đại từ sở hữu (theirs) đứng một mình, không có danh từ theo sau.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This laptop is not yours — it is _____.',
      options: [
        { id: 'a', text: 'my' },
        { id: 'b', text: 'me' },
        { id: 'c', text: 'mine' },
        { id: 'd', text: 'myself' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Sau chỗ trống KHÔNG có danh từ, nên cần ĐẠI TỪ SỞ HỮU đứng một mình → "mine" (= my laptop). "my" sai vì tính từ sở hữu bắt buộc phải có danh từ theo sau.',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Please keep this information between you and _____.',
      options: [
        { id: 'a', text: 'I' },
        { id: 'b', text: 'me' },
        { id: 'c', text: 'my' },
        { id: 'd', text: 'mine' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Sau GIỚI TỪ ("between") phải dùng ĐẠI TỪ TÂN NGỮ → "me". "between you and I" là lỗi sai rất phổ biến, kể cả với người bản xứ, nhưng trong TOEIC luôn bị tính là sai.',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền đại từ phản thân phù hợp: "She cut _____ while she was cooking dinner."',
      correctAnswer: { accepted: ['herself'] },
      explanation:
        'Khi chủ ngữ và tân ngữ là cùng một người, dùng ĐẠI TỪ PHẢN THÂN → "herself". Bảng tham chiếu: myself, yourself, himself, herself, itself, ourselves, yourselves, themselves.',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Đại từ tân ngữ (me, him, her, us, them) đứng sau động từ hoặc sau giới từ.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Đây chính là quy tắc vị trí phân biệt đại từ chủ ngữ với đại từ tân ngữ, và là căn cứ để loại đáp án nhanh trong Part 5.',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp thành câu đúng, chú ý vị trí của đại từ chủ ngữ và đại từ tân ngữ:',
      options: [
        { id: 'r1', text: 'She' },
        { id: 'r2', text: 'sent' },
        { id: 'r3', text: 'them' },
        { id: 'r4', text: 'the report' },
      ],
      correctAnswer: { orderedOptionIds: ['r1', 'r2', 'r3', 'r4'] },
      explanation:
        '"She" (đại từ chủ ngữ) đứng trước động từ; "them" (đại từ tân ngữ gián tiếp) đứng ngay sau động từ; "the report" là tân ngữ trực tiếp. → S + V + O1 + O2.',
    },
  ],
};

const SEEDS: SeedQuiz[] = [
  sentenceStructure,
  toBeVerb,
  partsOfSpeech,
  pronouns,
];

const seedOne = async (seed: SeedQuiz): Promise<void> => {
  const lesson = await prisma.lesson.findFirst({
    where: { title: seed.lessonTitle },
    select: { id: true, title: true },
  });

  if (!lesson) {
    throw new Error(
      `Lesson not found: "${seed.lessonTitle}". No quiz was written for it.`,
    );
  }

  // Validate EVERYTHING before touching the database, using the same
  // function the PUT endpoint uses — a bad question fails here, not
  // half-way through a write.
  seed.questions.forEach((question, index) => {
    const optionIds = (question.options ?? []).map((o) => o.id);
    if (new Set(optionIds).size !== optionIds.length) {
      throw new Error(
        `[${seed.lessonTitle}] question #${index + 1}: duplicate option ids`,
      );
    }
    const reason = validateQuestionContent({
      type: question.type,
      options: question.options ?? null,
      correctAnswer: question.correctAnswer,
    });
    if (reason) {
      throw new Error(
        `[${seed.lessonTitle}] question #${index + 1} is invalid: ${reason}`,
      );
    }
  });

  await prisma.$transaction(async (tx) => {
    // Reuse the existing QUIZ task if there is one, so LessonTaskProgress
    // rows (which reference it) survive a re-seed.
    let task = await tx.lessonTask.findFirst({
      where: { lessonId: lesson.id, type: 'QUIZ' },
    });

    if (!task) {
      const maxOrderIndex = await tx.lessonTask.aggregate({
        where: { lessonId: lesson.id },
        _max: { orderIndex: true },
      });
      task = await tx.lessonTask.create({
        data: {
          lessonId: lesson.id,
          type: 'QUIZ',
          title: 'Quiz',
          content: {},
          points: seed.questions.length,
          orderIndex: (maxOrderIndex._max.orderIndex ?? -1) + 1,
          passingScorePercent: seed.passingScorePercent,
          feedbackMode: 'IMMEDIATE',
          isPublished: true,
        },
      });
    } else {
      task = await tx.lessonTask.update({
        where: { id: task.id },
        data: {
          points: seed.questions.length,
          passingScorePercent: seed.passingScorePercent,
          feedbackMode: 'IMMEDIATE',
          isPublished: true,
        },
      });
    }

    await tx.question.deleteMany({ where: { taskId: task.id } });

    for (const [index, question] of seed.questions.entries()) {
      await tx.question.create({
        data: {
          taskId: task.id,
          type: question.type,
          content: question.content,
          options: question.options ?? undefined,
          correctAnswer: question.correctAnswer as object,
          explanation: question.explanation,
          orderIndex: index,
        },
      });
    }

    // Any in-flight attempt referenced question ids that no longer exist.
    // Cleared so a student mid-quiz starts cleanly against the new set.
    // Deliberately does NOT touch attemptsCount/score/completedAt — that is
    // real history and this script has no business rewriting it.
    //
    // `Prisma.DbNull`, NOT `undefined`: on a Json column `undefined` means
    // "leave this field alone", so the original version of this line silently
    // did nothing and left every stale attempt record in place.
    await tx.lessonTaskProgress.updateMany({
      where: { taskId: task.id },
      data: { currentAttemptAnswers: Prisma.DbNull, currentAttemptSeed: null },
    });
  });

  console.log(
    `  ✓ ${lesson.title}\n      ${seed.questions.length} questions, pass ≥ ${seed.passingScorePercent}%, IMMEDIATE feedback, published`,
  );
};

const main = async (): Promise<void> => {
  console.log('\nSeeding Grammar lesson quizzes...\n');
  for (const seed of SEEDS) {
    await seedOne(seed);
  }
  console.log('\nDone.\n');
};

main()
  .catch((error) => {
    console.error('\nSeed failed — no partial quiz was left behind:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
