import { Prisma, PrismaClient, QuestionType, QuestionDifficulty } from '@prisma/client';
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
  // Optional so the original 4 lessons' questions (authored before this field
  // existed) keep typechecking unchanged; every question added from this
  // point on sets it.
  difficulty?: QuestionDifficulty;
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
      difficulty: 'MEDIUM',
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
      difficulty: 'MEDIUM',
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
      difficulty: 'EASY',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Một câu trần thuật hoàn chỉnh trong tiếng Anh tối thiểu phải có Chủ ngữ (S) và Động từ chính (V).',
      correctAnswer: { value: true },
      explanation:
        'Đúng. S + V là cấu trúc tối thiểu (ví dụ: "She sleeps."). Các thành phần O, C, A chỉ xuất hiện tùy theo loại động từ. Vì vậy "Sleeps she early every night." sai do thiếu/sai vị trí chủ ngữ.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu theo cấu trúc S + V + C với động từ nối "taste" ở thì hiện tại đơn: "The soup _____ delicious."',
      correctAnswer: { accepted: ['tastes'] },
      explanation:
        '"The soup" là chủ ngữ số ít nên động từ thêm -s: "tastes". "taste" ở đây là động từ nối, theo sau là bổ ngữ "delicious" mô tả chủ ngữ.',
      difficulty: 'MEDIUM',
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
      difficulty: 'MEDIUM',
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
      difficulty: 'HARD',
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
      difficulty: 'EASY',
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
      difficulty: 'MEDIUM',
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
      difficulty: 'EASY',
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
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Với chủ ngữ "I", động từ to be ở thì hiện tại đơn là "am".',
      correctAnswer: { value: true },
      explanation:
        'Đúng. "I am" là dạng duy nhất dùng "am". Lưu ý dạng phủ định rút gọn thông dụng là "I\'m not" (không có dạng "amn\'t").',
      difficulty: 'EASY',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Câu "Are you a student?" và "Do you study English?" đều đúng ngữ pháp.',
      correctAnswer: { value: true },
      explanation:
        'Đúng, vì mỗi câu dùng đúng loại động từ của nó: câu đầu có vị ngữ là to be nên đảo "are" lên trước; câu sau có động từ thường "study" nên cần trợ động từ "do".',
      difficulty: 'HARD',
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
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Ngữ pháp cơ bản — Bài 3: Danh Từ Tiếng Anh Cơ Bản
//    Source of truth: the lesson's own notes — countable vs uncountable,
//    singular/plural with -s, a/an-adjacent quantifier hints (some/many),
//    the two Common Mistakes (many money / informations).
//    Notes are thin (663 chars) — deliberately did NOT test irregular
//    plurals, demonstratives, or the noun -es/-ies spelling exceptions,
//    since none of those are stated in this lesson.
// ---------------------------------------------------------------------------
const basicNouns: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 3: Danh Từ Tiếng Anh Cơ Bản',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Danh từ nào dưới đây là danh từ KHÔNG đếm được?',
      options: [
        { id: 'a', text: 'book' },
        { id: 'b', text: 'water' },
        { id: 'c', text: 'cat' },
        { id: 'd', text: 'apple' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"water" là danh từ không đếm được (không thể nói "a water" hay "two waters"). "book", "cat", "apple" đều đếm được vì có thể đếm bằng số: a book, two cats.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng số nhiều đúng: "I have two _____."',
      options: [
        { id: 'a', text: 'book' },
        { id: 'b', text: 'books' },
        { id: 'c', text: 'bookes' },
        { id: 'd', text: 'bookies' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Danh từ đếm được số nhiều thêm "-s" ở dạng cơ bản nhất: book → books.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn từ đúng: "She doesn\'t have _____ time to finish the report."',
      options: [
        { id: 'a', text: 'many' },
        { id: 'b', text: 'much' },
        { id: 'c', text: 'a' },
        { id: 'd', text: 'few' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"time" (thời gian) là danh từ không đếm được, nên dùng "much", không dùng "many" (chỉ dùng cho danh từ đếm được số nhiều).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: '"Books" là danh từ đếm được, ở dạng số nhiều.',
      correctAnswer: { value: true },
      explanation: 'Đúng. "book" đếm được nên có dạng số nhiều "books" (thêm -s).',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu với danh từ không đếm được nghĩa là "nước": "I need some _____."',
      correctAnswer: { accepted: ['water'] },
      explanation:
        '"water" (nước) là danh từ không đếm được, nên đi với "some" chứ không có dạng số nhiều "waters".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'She has many money.' },
        { id: 'b', text: 'She has much money.' },
        { id: 'c', text: 'She has many moneys.' },
        { id: 'd', text: 'She has much moneys.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"money" là danh từ không đếm được: dùng "much" (không dùng "many"), và không có dạng số nhiều "moneys".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Ngữ pháp cơ bản — Bài 4: Động từ thường
//    Source of truth: the lesson's own notes — regular verbs vs to be,
//    present simple conjugation (bare form / +s,-es for he/she/it),
//    affirmative/negative(do/does not)/question(Do/Does) forms.
// ---------------------------------------------------------------------------
const regularVerbs: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 4: Động từ thường',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng đúng: "She _____ the piano every weekend."',
      options: [
        { id: 'a', text: 'play' },
        { id: 'b', text: 'plays' },
        { id: 'c', text: 'playing' },
        { id: 'd', text: 'played' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"She" là ngôi thứ ba số ít nên động từ thường thêm -s: "plays".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng đúng: "They _____ not watch TV in the morning."',
      options: [
        { id: 'a', text: 'do' },
        { id: 'b', text: 'does' },
        { id: 'c', text: 'is' },
        { id: 'd', text: 'are' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"They" dùng trợ động từ "do" cho phủ định với động từ thường: "do not" (don\'t). "does" chỉ dùng cho He/She/It.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng đúng: "_____ he work at a hospital?"',
      options: [
        { id: 'a', text: 'Do' },
        { id: 'b', text: 'Does' },
        { id: 'c', text: 'Is' },
        { id: 'd', text: 'Are' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"he" là ngôi thứ ba số ít nên câu hỏi động từ thường mượn trợ động từ "Does".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Chia đúng động từ "watch" theo ngôi "she" (động từ tận cùng bằng -ch thêm -es): "She _____ TV every evening."',
      correctAnswer: { accepted: ['watches'] },
      explanation:
        'Động từ tận cùng bằng -ch, -sh, -o, -x, -ss thêm "-es" thay vì chỉ "-s": watch → watches.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Với chủ ngữ "They", động từ thường ở thì hiện tại đơn không cần thêm -s/-es.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Chỉ ngôi He/She/It (số ít) mới thêm -s/-es; I/You/We/They dùng động từ nguyên thể.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'He play football.' },
        { id: 'b', text: 'He plays football.' },
        { id: 'c', text: 'He are playing football.' },
        { id: 'd', text: 'He does plays football.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"He" là ngôi thứ ba số ít nên động từ thường phải thêm -s: "plays". Câu (d) sai vì sau "does" động từ phải về dạng nguyên thể, không giữ -s.',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Ngữ pháp cơ bản — Bài 5: Tính Từ Tiếng Anh Cơ Bản
//    Source of truth: the lesson's own notes — adjective position (before
//    noun / after to be), comparative (-er / more), superlative (-est /
//    most), the two Common Mistakes (more tall, most easiest).
// ---------------------------------------------------------------------------
const basicAdjectives: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 5: Tính Từ Tiếng Anh Cơ Bản',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng đúng: "This book is _____ than that one."',
      options: [
        { id: 'a', text: 'interesting' },
        { id: 'b', text: 'more interesting' },
        { id: 'c', text: 'most interesting' },
        { id: 'd', text: 'interestinger' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"interesting" là tính từ dài (3 âm tiết trở lên) nên so sánh hơn dùng "more", không thêm "-er".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng đúng: "He is the _____ student in the class."',
      options: [
        { id: 'a', text: 'tall' },
        { id: 'b', text: 'taller' },
        { id: 'c', text: 'tallest' },
        { id: 'd', text: 'more tall' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"tall" là tính từ ngắn nên so sánh nhất thêm "-est", đi kèm "the": "the tallest".',
      difficulty: 'EASY',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Tính từ có thể đứng ngay trước danh từ, hoặc đứng sau động từ "TO BE".',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Ví dụ: "a big house" (trước danh từ) và "The house is big." (sau to be).',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content: 'Điền dạng so sánh hơn của "big": "This car is _____ than mine."',
      correctAnswer: { accepted: ['bigger'] },
      explanation:
        '"big" là tính từ ngắn 1 âm tiết, tận cùng phụ âm-nguyên âm-phụ âm nên gấp đôi phụ âm cuối rồi thêm -er: "bigger".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'She is more tall than him.' },
        { id: 'b', text: 'She is taller than him.' },
        { id: 'c', text: 'She is tall more than him.' },
        { id: 'd', text: 'She is the more tall.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"tall" là tính từ ngắn nên chỉ cần thêm "-er", không dùng thêm "more" (tránh lỗi so sánh kép).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'This is the most easiest way.' },
        { id: 'b', text: 'This is the easiest way.' },
        { id: 'c', text: 'This is the more easy way.' },
        { id: 'd', text: 'This is easier way.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"easy" là tính từ ngắn nên so sánh nhất chỉ cần "-est" ("easiest"), không dùng thêm "most" trước đó (lỗi so sánh kép, giống "more tall").',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 6. Ngữ pháp cơ bản — Bài 6: Trật Tự Tính Từ
//    Source of truth: the lesson's own notes — Opinion -> Size -> Shape ->
//    Color -> Origin -> Material -> Purpose -> Noun, and its own worked
//    examples ("a beautiful small round red Italian leather bag", "a nice
//    blue cotton shirt", "a big old white house").
// ---------------------------------------------------------------------------
const adjectiveOrder: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 6: Trật Tự Tính Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He wears a nice _____ shirt.',
      options: [
        { id: 'a', text: 'blue cotton' },
        { id: 'b', text: 'cotton blue' },
        { id: 'c', text: 'blue cotton nice' },
        { id: 'd', text: 'cotton nice blue' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Trật tự đúng là Color (blue) trước Material (cotton): "a nice blue cotton shirt" — đúng như ví dụ trong bài học.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trật tự tính từ đúng là: Ý kiến (Opinion) → Kích thước (Size) → Hình dạng (Shape) → Màu sắc (Color) → Nguồn gốc (Origin) → Chất liệu (Material) → Mục đích (Purpose) → Danh từ.',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là trật tự tính từ chuẩn đã học trong bài.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the correctly ordered sentence.',
      options: [
        { id: 'a', text: 'a big wooden table' },
        { id: 'b', text: 'a wooden big table' },
        { id: 'c', text: 'a table big wooden' },
        { id: 'd', text: 'wooden a big table' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Size (big) đứng trước Material (wooden): "a big wooden table".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp các tính từ theo đúng trật tự (Kích thước → Hình dạng → Màu sắc → Danh từ):',
      options: [
        { id: 's1', text: 'small' },
        { id: 's2', text: 'round' },
        { id: 's3', text: 'red' },
        { id: 's4', text: 'bag' },
      ],
      correctAnswer: { orderedOptionIds: ['s1', 's2', 's3', 's4'] },
      explanation:
        'Size (small) → Shape (round) → Color (red) → Noun (bag): "small round red bag".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'She bought a _____ bag. (theo đúng ví dụ đã học trong bài: Ý kiến – Kích thước – Hình dạng – Màu sắc – Nguồn gốc – Chất liệu)',
      options: [
        { id: 'a', text: 'beautiful small round red Italian leather' },
        { id: 'b', text: 'leather Italian red round small beautiful' },
        { id: 'c', text: 'small beautiful red round Italian leather' },
        { id: 'd', text: 'red small beautiful round Italian leather' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Đúng trật tự Opinion (beautiful) – Size (small) – Shape (round) – Color (red) – Origin (Italian) – Material (leather), đúng như ví dụ gốc trong bài học.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the correctly ordered sentence.',
      options: [
        { id: 'a', text: 'a plastic small toy' },
        { id: 'b', text: 'a small plastic toy' },
        { id: 'c', text: 'a toy small plastic' },
        { id: 'd', text: 'small a plastic toy' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Size (small) đứng trước Material (plastic): "a small plastic toy".',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 7. Ngữ pháp cơ bản — Bài 7: Tính Từ Đuôi -ing và -ed
//    Source of truth: the lesson's own notes — -ing describes what CAUSES a
//    feeling (the thing/situation), -ed describes how a PERSON feels.
// ---------------------------------------------------------------------------
const ingEdAdjectives: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 7: Tính Từ Đuôi ing và ed',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The movie is _____.',
      options: [
        { id: 'a', text: 'interesting' },
        { id: 'b', text: 'interested' },
        { id: 'c', text: 'interest' },
        { id: 'd', text: 'interests' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"The movie" là SỰ VẬT gây ra cảm giác thú vị cho người xem, nên dùng đuôi -ing: "interesting".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I am _____ in the movie.',
      options: [
        { id: 'a', text: 'interesting' },
        { id: 'b', text: 'interested' },
        { id: 'c', text: 'interest' },
        { id: 'd', text: 'interests' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"I" là NGƯỜI cảm thấy hứng thú, nên dùng đuôi -ed: "interested".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'I am boring.' },
        { id: 'b', text: 'I am bored.' },
        { id: 'c', text: 'I am bore.' },
        { id: 'd', text: 'I bored.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Nếu muốn nói "tôi cảm thấy chán", phải dùng "bored" (đuôi -ed, mô tả cảm xúc người nói). "I am boring." có nghĩa khác hẳn: "tôi là người gây chán".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Tính từ đuôi -ed dùng để mô tả cảm xúc của con người, còn đuôi -ing mô tả đặc điểm gây ra cảm xúc đó của sự vật/sự việc.',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là quy tắc cốt lõi của bài học.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu (bài học GÂY chán, không phải bài học đang cảm thấy chán): "The lesson is _____."',
      correctAnswer: { accepted: ['boring'] },
      explanation:
        '"The lesson" là sự việc gây ra cảm giác chán, nên dùng đuôi -ing: "boring".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Students are _____ after the long lecture.',
      options: [
        { id: 'a', text: 'boring' },
        { id: 'b', text: 'bored' },
        { id: 'c', text: 'bore' },
        { id: 'd', text: 'bores' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"Students" là NGƯỜI cảm thấy chán sau bài giảng dài, nên dùng đuôi -ed: "bored".',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 8. Ngữ pháp cơ bản — Bài 8: Trạng Từ
//    Source of truth: the lesson's own notes — manner/time/place/frequency/
//    degree categories, position rules, -ly formation, the two Common
//    Mistakes (speaks good English, runs fastly).
// ---------------------------------------------------------------------------
const adverbs: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 8: Trạng Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She speaks English _____.',
      options: [
        { id: 'a', text: 'fluent' },
        { id: 'b', text: 'fluently' },
        { id: 'c', text: 'fluency' },
        { id: 'd', text: 'fluenting' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Bổ nghĩa cho động từ "speaks" cần TRẠNG TỪ, đứng sau động từ: "speaks English fluently".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He _____ goes to school by bus.',
      options: [
        { id: 'a', text: 'often' },
        { id: 'b', text: 'oftenly' },
        { id: 'c', text: 'offen' },
        { id: 'd', text: 'oftening' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"often" đã là trạng từ tần suất sẵn — không thêm "-ly" vào những trạng từ đã có sẵn dạng đúng.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'She speaks good English.' },
        { id: 'b', text: 'She speaks English well.' },
        { id: 'c', text: 'She speaks well English.' },
        { id: 'd', text: 'She good speaks English.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Bổ nghĩa cho động từ "speaks" cần trạng từ "well" (không phải tính từ "good"), và trạng từ cách thức đứng sau tân ngữ: "speaks English well".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Đổi tính từ "quick" thành trạng từ: "He finished the task very _____."',
      correctAnswer: { accepted: ['quickly'] },
      explanation: 'Hầu hết trạng từ được tạo bằng cách thêm "-ly" vào tính từ: quick → quickly.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'He runs fastly.' },
        { id: 'b', text: 'He runs fast.' },
        { id: 'c', text: 'He fast runs.' },
        { id: 'd', text: 'He runly fast.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"fast" là trạng từ bất quy tắc — giữ nguyên dạng, không thêm "-ly" ("fastly" không tồn tại).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trạng từ chỉ tần suất (always, often, usually, sometimes, never) thường đứng TRƯỚC động từ chính trong câu.',
      correctAnswer: { value: true },
      explanation: 'Đúng. Ví dụ: "He often goes to school." — "often" đứng trước "goes".',
      difficulty: 'EASY',
    },
  ],
};

// ---------------------------------------------------------------------------
// 9. Ngữ pháp cơ bản — Bài 9: Mạo Từ A, An, The
//    Source of truth: the lesson's own notes — a/an for indefinite singular
//    countable nouns (by SOUND), the for definite/unique nouns, no article
//    for generic nouns.
// ---------------------------------------------------------------------------
const articles: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 9: Mạo Từ A, An, The',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I saw _____ dog in the park.',
      options: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'an' },
        { id: 'c', text: 'the' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"dog" bắt đầu bằng phụ âm và đây là lần nhắc đầu tiên (chưa xác định) nên dùng "a".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She bought _____ orange.',
      options: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'an' },
        { id: 'c', text: 'the' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"orange" bắt đầu bằng nguyên âm (o) nên dùng "an".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ sun rises in the east.',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'An' },
        { id: 'c', text: 'The' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"sun" là vật thể duy nhất nên luôn dùng "the": "the sun".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: '"A" và "an" chỉ dùng với danh từ số ít đếm được.',
      correctAnswer: { value: true },
      explanation: 'Đúng. Danh từ số nhiều hoặc không đếm được không đi với "a/an".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'She is an university student.' },
        { id: 'b', text: 'She is a university student.' },
        { id: 'c', text: 'She is the university student.' },
        { id: 'd', text: 'She is university student.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"university" tuy bắt đầu bằng chữ cái nguyên âm "u" nhưng ĐỌC bằng âm phụ âm /juː/, nên vẫn dùng "a", không dùng "an".',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền mạo từ đúng: "I saw a dog in the park. _____ dog was very cute." (đã nhắc đến ở câu trước)',
      correctAnswer: { accepted: ['the', 'The'] },
      explanation:
        'Con chó đã được nhắc đến ở câu trước (xác định), nên câu sau dùng "The dog".',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 11. Ngữ pháp cơ bản — Bài 11: Danh Động Từ To V và V ing
//    Source of truth: the lesson's own notes — gerund (subject/after
//    verb/after preposition) vs infinitive (after verb/purpose/after
//    adjective), verb lists, and the remember/stop dual-meaning pairs.
// ---------------------------------------------------------------------------
const gerundInfinitive: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 11: Danh Động Từ To V và V ing',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She enjoys _____ football.',
      options: [
        { id: 'a', text: 'play' },
        { id: 'b', text: 'to play' },
        { id: 'c', text: 'playing' },
        { id: 'd', text: 'played' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"enjoy" luôn theo sau bởi V-ing (Gerund): "enjoys playing".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He decided _____ home early.',
      options: [
        { id: 'a', text: 'going' },
        { id: 'b', text: 'go' },
        { id: 'c', text: 'to go' },
        { id: 'd', text: 'went' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"decide" luôn theo sau bởi to V (Infinitive): "decided to go".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He is good at _____.',
      options: [
        { id: 'a', text: 'dance' },
        { id: 'b', text: 'to dance' },
        { id: 'c', text: 'dancing' },
        { id: 'd', text: 'danced' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Sau giới từ ("at") luôn dùng Gerund (V-ing): "good at dancing".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: '"Remember doing" và "remember to do" mang nghĩa khác nhau.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. "Remember doing" = nhớ ĐÃ làm (việc trong quá khứ); "remember to do" = nhớ PHẢI làm (việc chưa làm).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu (Gerund làm chủ ngữ, chia to be theo số ít): "Swimming _____ fun."',
      correctAnswer: { accepted: ['is'] },
      explanation:
        '"Swimming" (V-ing làm chủ ngữ) được coi là danh từ số ít, nên động từ to be chia "is".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'She enjoys to read.' },
        { id: 'b', text: 'She enjoys reading.' },
        { id: 'c', text: 'She enjoy reading.' },
        { id: 'd', text: 'She enjoys read.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"enjoy" theo sau bởi Gerund: "enjoys reading". Câu (c) sai vì thiếu -s cho ngôi thứ ba số ít "She".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 12. Ngữ pháp cơ bản — Bài 12: Lượng Từ
//    Source of truth: the lesson's own notes — many/few/a few for countable,
//    much/little/a little for uncountable, some/any/a lot of for both.
// ---------------------------------------------------------------------------
const quantifiers: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 12: Lượng Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She has _____ friends in this city.',
      options: [
        { id: 'a', text: 'much' },
        { id: 'b', text: 'many' },
        { id: 'c', text: 'little' },
        { id: 'd', text: 'a little' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"friends" đếm được số nhiều nên dùng "many".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: "He doesn't have _____ money.",
      options: [
        { id: 'a', text: 'many' },
        { id: 'b', text: 'much' },
        { id: 'c', text: 'few' },
        { id: 'd', text: 'a few' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"money" không đếm được nên dùng "much" trong câu phủ định.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'We need _____ water for the trip.',
      options: [
        { id: 'a', text: 'many' },
        { id: 'b', text: 'some' },
        { id: 'c', text: 'few' },
        { id: 'd', text: 'a few' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"some" dùng trong câu khẳng định cho cả danh từ đếm được và không đếm được: "some water".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Do you have _____ questions?',
      options: [
        { id: 'a', text: 'some' },
        { id: 'b', text: 'any' },
        { id: 'c', text: 'much' },
        { id: 'd', text: 'little' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"any" thường dùng trong câu nghi vấn (và phủ định), thay vì "some".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        '"A few" nghĩa là "một vài, đủ dùng", còn "few" nghĩa là "rất ít, gần như không có".',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là điểm phân biệt quan trọng giữa hai lượng từ này.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'I have much friends.' },
        { id: 'b', text: 'I have many friends.' },
        { id: 'c', text: 'She has few money.' },
        { id: 'd', text: 'She has many money.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"friends" đếm được nên dùng "many". "money" không đếm được nên phải dùng "little", không dùng "few" hay "many".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 13. Ngữ pháp cơ bản — Bài 13: Thì Hiện Tại Đơn
//    Source of truth: the lesson's own notes — habits/facts, conjugation,
//    negative/question forms, frequency adverbs.
// ---------------------------------------------------------------------------
const presentSimpleTense: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 13: Thì Hiện Tại Đơn',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I _____ to school every day.',
      options: [
        { id: 'a', text: 'go' },
        { id: 'b', text: 'goes' },
        { id: 'c', text: 'going' },
        { id: 'd', text: 'went' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"I" dùng động từ nguyên thể, không thêm -s: "I go".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She _____ at a bank.',
      options: [
        { id: 'a', text: 'work' },
        { id: 'b', text: 'works' },
        { id: 'c', text: 'working' },
        { id: 'd', text: 'worked' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"She" là ngôi thứ ba số ít nên thêm -s: "works".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'They _____ play football on Sundays.',
      options: [
        { id: 'a', text: "doesn't" },
        { id: 'b', text: "don't" },
        { id: 'c', text: "isn't" },
        { id: 'd', text: "aren't" },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"They" dùng trợ động từ "don\'t" để phủ định động từ thường.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ he like coffee?',
      options: [
        { id: 'a', text: 'Do' },
        { id: 'b', text: 'Does' },
        { id: 'c', text: 'Is' },
        { id: 'd', text: 'Are' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"he" là ngôi thứ ba số ít nên câu hỏi dùng "Does".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Thì hiện tại đơn thường đi kèm với các trạng từ tần suất như always, usually, often, sometimes, never.',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là dấu hiệu nhận biết phổ biến của thì hiện tại đơn.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'He go to school.' },
        { id: 'b', text: 'He goes to school.' },
        { id: 'c', text: 'He going to school.' },
        { id: 'd', text: 'He is go to school.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"He" là ngôi thứ ba số ít nên động từ phải thêm -s: "goes".',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 14. Ngữ pháp cơ bản — Bài 14: Thì Quá Khứ Đơn
//    Source of truth: the lesson's own notes — regular -ed, irregular verbs,
//    did not / Did negative and question forms, past time signals.
// ---------------------------------------------------------------------------
const pastSimpleTense: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 14: Thì Quá Khứ Đơn',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I _____ my grandparents last weekend.',
      options: [
        { id: 'a', text: 'visit' },
        { id: 'b', text: 'visits' },
        { id: 'c', text: 'visited' },
        { id: 'd', text: 'visiting' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Động từ thường ở quá khứ đơn thêm -ed: visit → visited.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She _____ to the market yesterday.',
      options: [
        { id: 'a', text: 'go' },
        { id: 'b', text: 'goes' },
        { id: 'c', text: 'went' },
        { id: 'd', text: 'gone' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"go" là động từ bất quy tắc: quá khứ đơn là "went".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'They _____ play football yesterday.',
      options: [
        { id: 'a', text: "don't" },
        { id: 'b', text: "doesn't" },
        { id: 'c', text: "didn't" },
        { id: 'd', text: "wasn't" },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Phủ định thì quá khứ đơn dùng "didn\'t" cho mọi chủ ngữ.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ you watch the movie?',
      options: [
        { id: 'a', text: 'Do' },
        { id: 'b', text: 'Does' },
        { id: 'c', text: 'Did' },
        { id: 'd', text: 'Were' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Câu hỏi thì quá khứ đơn dùng "Did" cho mọi chủ ngữ.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Với câu phủ định và nghi vấn ở thì quá khứ đơn, động từ chính trở về dạng nguyên thể, không chia -ed.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. "didn\'t"/"Did" đã mang nghĩa quá khứ rồi, nên động từ chính giữ nguyên thể: "didn\'t go", không phải "didn\'t went".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: "She didn't went to school." },
        { id: 'b', text: "She didn't go to school." },
        { id: 'c', text: 'She not went to school.' },
        { id: 'd', text: "She didn't goes to school." },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Sau "didn\'t", động từ chính phải về nguyên thể: "go", không phải "went".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 15. Ngữ pháp cơ bản — Bài 15: Thì Hiện Tại Tiếp Diễn
//    Source of truth: the lesson's own notes — am/is/are + V-ing, negative/
//    question forms, signal words, the stative-verb exception.
// ---------------------------------------------------------------------------
const presentContinuousTense: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 15: Thì Hiện Tại Tiếp Diễn',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I _____ English now.',
      options: [
        { id: 'a', text: 'study' },
        { id: 'b', text: 'studies' },
        { id: 'c', text: 'am studying' },
        { id: 'd', text: 'studied' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"now" là dấu hiệu của thì hiện tại tiếp diễn: am/is/are + V-ing.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She _____ TV at the moment.',
      options: [
        { id: 'a', text: 'watch' },
        { id: 'b', text: 'watches' },
        { id: 'c', text: 'is watching' },
        { id: 'd', text: 'watched' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"at the moment" là dấu hiệu hiện tại tiếp diễn: "is watching".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'They _____ not playing football.',
      options: [
        { id: 'a', text: 'is' },
        { id: 'b', text: 'are' },
        { id: 'c', text: 'am' },
        { id: 'd', text: 'do' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"They" chia với "are" trong thì hiện tại tiếp diễn.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ you listening to me?',
      options: [
        { id: 'a', text: 'Do' },
        { id: 'b', text: 'Are' },
        { id: 'c', text: 'Is' },
        { id: 'd', text: 'Does' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"you" chia với "Are" để đảo lên đầu câu hỏi hiện tại tiếp diễn.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "Động từ chỉ trạng thái như 'know', 'like', 'believe', 'understand' không dùng ở thì hiện tại tiếp diễn.",
      correctAnswer: { value: true },
      explanation:
        'Đúng, những động từ chỉ trạng thái tư duy/cảm xúc này không diễn tả một hành động đang xảy ra nên không chia tiếp diễn.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'I am knowing the answer.' },
        { id: 'b', text: 'I know the answer.' },
        { id: 'c', text: 'I am know the answer.' },
        { id: 'd', text: 'I knowing the answer.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"know" là động từ chỉ trạng thái, không chia thì tiếp diễn: dùng hiện tại đơn "I know".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 16. Ngữ pháp cơ bản — Bài 16: Thì Hiện Tại Hoàn Thành
//    Source of truth: the lesson's own notes — have/has + V3, its 4 uses,
//    for/since, already/just/yet/ever/never.
// ---------------------------------------------------------------------------
const presentPerfectTense: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 16: Thì Hiện Tại Hoàn Thành',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I _____ English for 5 years.',
      options: [
        { id: 'a', text: 'study' },
        { id: 'b', text: 'studied' },
        { id: 'c', text: 'have studied' },
        { id: 'd', text: 'has studied' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"for 5 years" (khoảng thời gian kéo dài đến hiện tại) + "I" → "have studied".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She _____ just finished her homework.',
      options: [
        { id: 'a', text: 'have' },
        { id: 'b', text: 'has' },
        { id: 'c', text: 'is' },
        { id: 'd', text: 'was' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"She" (ngôi thứ ba số ít) dùng "has" trong thì hiện tại hoàn thành.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ you ever been to London?',
      options: [
        { id: 'a', text: 'Do' },
        { id: 'b', text: 'Have' },
        { id: 'c', text: 'Did' },
        { id: 'd', text: 'Has' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"you" dùng "Have" để hỏi về kinh nghiệm trong thì hiện tại hoàn thành.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành: "They _____ (not / see) that movie yet."',
      correctAnswer: { accepted: ["haven't seen", 'have not seen', "havent seen"] },
      explanation: '"yet" báo hiệu phủ định hiện tại hoàn thành: "haven\'t seen".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        '"Since" đi với mốc thời gian (since 2010), còn "for" đi với khoảng thời gian (for 2 hours).',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là điểm phân biệt quan trọng của hai từ này.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'I have went to school.' },
        { id: 'b', text: 'I have gone to school.' },
        { id: 'c', text: 'I have go to school.' },
        { id: 'd', text: 'I has gone to school.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"go" ở dạng V3 (past participle) là "gone", không phải "went" (đó là V2).',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 17. Ngữ pháp cơ bản — Bài 17: Thì Quá Khứ Hoàn Thành
//    Source of truth: the lesson's own notes — had + V3, for an action
//    completed before another past action, before/after/by the time.
// ---------------------------------------------------------------------------
const pastPerfectTense: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 17: Thì Quá Khứ Hoàn Thành',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She _____ her homework before she went out.',
      options: [
        { id: 'a', text: 'finish' },
        { id: 'b', text: 'finished' },
        { id: 'c', text: 'had finished' },
        { id: 'd', text: 'has finished' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Việc "finish homework" xảy ra TRƯỚC một hành động khác trong quá khứ ("went out"), nên dùng "had finished".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'They _____ left when I arrived.',
      options: [
        { id: 'a', text: 'have' },
        { id: 'b', text: 'had' },
        { id: 'c', text: 'has' },
        { id: 'd', text: 'was' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Quá khứ hoàn thành dùng "had" cho mọi chủ ngữ: "had left".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He _____ seen that movie before last night.',
      options: [
        { id: 'a', text: "hasn't" },
        { id: 'b', text: "hadn't" },
        { id: 'c', text: "didn't" },
        { id: 'd', text: "doesn't" },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Phủ định quá khứ hoàn thành: "hadn\'t seen".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành câu hỏi quá khứ hoàn thành: "_____ you ever visited Hue before 2020?"',
      correctAnswer: { accepted: ['had', 'Had'] },
      explanation: 'Câu hỏi quá khứ hoàn thành đảo "Had" lên đầu câu.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Thì quá khứ hoàn thành dùng để diễn tả hành động xảy ra TRƯỚC một hành động khác trong quá khứ.',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là chức năng cốt lõi của thì này.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'When I arrived, she finished her homework.' },
        { id: 'b', text: 'When I arrived, she had finished her homework.' },
        { id: 'c', text: 'When I arrived, she has finished her homework.' },
        { id: 'd', text: 'When I arrived, she finish her homework.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Việc "finish homework" xảy ra TRƯỚC "arrived" (một mốc quá khứ khác), nên phải dùng quá khứ hoàn thành "had finished".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 18. Ngữ pháp cơ bản — Bài 18: Câu Bị Động
//    Source of truth: the lesson's own notes — S + be + V3 (+ by O), passive
//    forms for present simple/past simple/present continuous/present
//    perfect, when "by" is dropped.
// ---------------------------------------------------------------------------
const passiveVoice: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 18: Câu Bị Động',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'A letter _____ by her every week.',
      options: [
        { id: 'a', text: 'write' },
        { id: 'b', text: 'writes' },
        { id: 'c', text: 'is written' },
        { id: 'd', text: 'was written' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Bị động thì hiện tại đơn: am/is/are + V3. "A letter" số ít nên "is written".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'A bridge _____ last year.',
      options: [
        { id: 'a', text: 'build' },
        { id: 'b', text: 'built' },
        { id: 'c', text: 'was built' },
        { id: 'd', text: 'is built' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Bị động thì quá khứ đơn: was/were + V3. "last year" → "was built".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The car _____ right now.',
      options: [
        { id: 'a', text: 'repairs' },
        { id: 'b', text: 'is repairing' },
        { id: 'c', text: 'is being repaired' },
        { id: 'd', text: 'was repaired' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Bị động thì hiện tại tiếp diễn: am/is/are + being + V3. "right now" → "is being repaired".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Chuyển sang câu bị động: "She writes a letter." → "A letter _____ by her."',
      correctAnswer: { accepted: ['is written'] },
      explanation: 'Chủ động thì hiện tại đơn → bị động: "is written".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        '"By + tân ngữ" thường được lược bỏ trong câu bị động nếu không cần nhấn mạnh người thực hiện hành động.',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là quy tắc dùng câu bị động khi người thực hiện không quan trọng.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'The report has finished.' },
        { id: 'b', text: 'The report has been finished.' },
        { id: 'c', text: 'The report is finished by she.' },
        { id: 'd', text: 'The report have been finished.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Bị động thì hiện tại hoàn thành: have/has + been + V3. "The report" số ít nên "has been finished".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 19. Ngữ pháp cơ bản — Bài 19: Câu Điều Kiện
//    Source of truth: the lesson's own notes — conditional types 0-3, their
//    structures and meanings, "unless".
// ---------------------------------------------------------------------------
const conditionals: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 19: Câu Điều Kiện',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If you heat water to 100°C, it _____.',
      options: [
        { id: 'a', text: 'boil' },
        { id: 'b', text: 'boils' },
        { id: 'c', text: 'will boil' },
        { id: 'd', text: 'boiled' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Câu điều kiện loại 0 (sự thật hiển nhiên): If + hiện tại đơn, hiện tại đơn.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If it rains tomorrow, we _____ at home.',
      options: [
        { id: 'a', text: 'stay' },
        { id: 'b', text: 'stays' },
        { id: 'c', text: 'will stay' },
        { id: 'd', text: 'stayed' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Câu điều kiện loại 1 (khả năng có thật): If + hiện tại đơn, S + will + V.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If I _____ rich, I would travel the world.',
      options: [
        { id: 'a', text: 'am' },
        { id: 'b', text: 'was' },
        { id: 'c', text: 'were' },
        { id: 'd', text: 'will be' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Câu điều kiện loại 2 dùng "were" cho TẤT CẢ các ngôi, kể cả "I": "If I were rich".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu điều kiện loại 3: "If she _____ (study) harder, she would have passed the exam."',
      correctAnswer: { accepted: ['had studied'] },
      explanation: 'Câu điều kiện loại 3: If + S + had + V3, S + would have + V3.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Trong câu điều kiện loại 1, không dùng "will" ở mệnh đề IF.',
      correctAnswer: { value: true },
      explanation: 'Đúng. Mệnh đề IF dùng hiện tại đơn; "will" chỉ xuất hiện ở mệnh đề chính.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'If I will see him, I will tell him.' },
        { id: 'b', text: 'If I see him, I will tell him.' },
        { id: 'c', text: 'If I see him, I tell him will.' },
        { id: 'd', text: 'If I saw him, I will tell him.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Câu điều kiện loại 1: mệnh đề IF dùng hiện tại đơn, không dùng "will".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 20. Ngữ pháp cơ bản — Bài 20: So Sánh Trong Tiếng Anh
//    Source of truth: the lesson's own notes — short/long adjective rules,
//    irregular forms (good/bad/far), the two Common Mistakes.
// ---------------------------------------------------------------------------
const comparisonTense: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 20: So Sánh Trong Tiếng Anh',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She is _____ than her brother.',
      options: [
        { id: 'a', text: 'tall' },
        { id: 'b', text: 'taller' },
        { id: 'c', text: 'tallest' },
        { id: 'd', text: 'more tall' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"tall" là tính từ ngắn, so sánh hơn thêm "-er": "taller".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This book is _____ than that one.',
      options: [
        { id: 'a', text: 'interesting' },
        { id: 'b', text: 'more interesting' },
        { id: 'c', text: 'most interesting' },
        { id: 'd', text: 'interestinger' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"interesting" là tính từ dài, so sánh hơn dùng "more".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He is _____ student in the class.',
      options: [
        { id: 'a', text: 'good' },
        { id: 'b', text: 'better' },
        { id: 'c', text: 'the best' },
        { id: 'd', text: 'the bestest' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"good" là tính từ bất quy tắc: so sánh nhất là "the best".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Điền dạng so sánh hơn bất quy tắc của "bad": "Today is _____ than yesterday."',
      correctAnswer: { accepted: ['worse'] },
      explanation: 'bad → worse → the worst (bất quy tắc).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: '"Far" có hai dạng so sánh hơn: "farther" và "further".',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là tính từ bất quy tắc có hai dạng song song.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'She is more taller than me.' },
        { id: 'b', text: 'She is taller than me.' },
        { id: 'c', text: 'She is much taller as me.' },
        { id: 'd', text: 'She is taller as me.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"taller" đã là dạng so sánh hơn — không thêm "more" nữa (lỗi so sánh kép). So sánh hơn dùng "than", không dùng "as".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 21. Ngữ pháp cơ bản — Bài 21: Đại Từ Quan Hệ
//    Source of truth: the lesson's own notes — who (person), which (thing),
//    that (both), omitting the pronoun when it's the object.
// ---------------------------------------------------------------------------
const relativePronouns: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 21: Đại Từ Quan Hệ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The man _____ is standing there is my uncle.',
      options: [
        { id: 'a', text: 'which' },
        { id: 'b', text: 'who' },
        { id: 'c', text: 'whom' },
        { id: 'd', text: 'whose' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"The man" chỉ người, làm chủ ngữ của mệnh đề quan hệ, nên dùng "who".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The book _____ you gave me is interesting.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whom' },
        { id: 'd', text: 'what' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"The book" chỉ vật, nên dùng "which". "who"/"whom" chỉ dùng cho người; "what" không được dùng làm đại từ quan hệ trong cấu trúc này.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The car _____ she drives is new.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whom' },
        { id: 'd', text: 'whose' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"The car" chỉ vật, nên dùng "which".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Có thể bỏ đại từ quan hệ (that/who/which) khi nó đóng vai trò tân ngữ trong mệnh đề.',
      correctAnswer: { value: true },
      explanation: 'Đúng, ví dụ: "The book (that) I read was good."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Điền đại từ quan hệ đúng: "The woman _____ lives next door is a doctor."',
      correctAnswer: { accepted: ['who', 'that'] },
      explanation: '"The woman" chỉ người nên dùng "who" (hoặc "that" thay thế được).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'The man which is tall is my father.' },
        { id: 'b', text: 'The man who is tall is my father.' },
        { id: 'c', text: 'The car who is red is mine.' },
        { id: 'd', text: 'The book whom I read is good.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"man" chỉ người nên dùng "who", không dùng "which" (chỉ vật).',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 22. Ngữ pháp cơ bản — Bài 22: Phân Biệt Will Với Be Going To
//    Source of truth: the lesson's own notes — will for instant decisions/
//    promises/feeling-based predictions, be going to for prior plans/
//    evidence-based predictions.
// ---------------------------------------------------------------------------
const willVsGoingTo: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 22: Phân Biệt Will Với Be Going To',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "The phone is ringing — I _____ answer it. (quyết định ngay lúc nói)",
      options: [
        { id: 'a', text: 'will' },
        { id: 'b', text: 'am going to' },
        { id: 'c', text: 'going' },
        { id: 'd', text: 'am go to' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Quyết định tức thì ngay lúc nói dùng "will".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'She _____ visit her grandparents next weekend. (kế hoạch đã lên từ trước)',
      options: [
        { id: 'a', text: 'will' },
        { id: 'b', text: 'is going to' },
        { id: 'c', text: 'going to' },
        { id: 'd', text: 'is go to' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Kế hoạch đã định trước dùng "be going to".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Look at those clouds! It _____ rain.',
      options: [
        { id: 'a', text: 'will' },
        { id: 'b', text: 'is going to' },
        { id: 'c', text: 'is go to' },
        { id: 'd', text: 'going' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Dự đoán dựa trên bằng chứng hiện tại (nhìn thấy mây đen) dùng "be going to".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: '"Will" và "be going to" luôn có thể dùng thay thế nhau mà không thay đổi ý nghĩa.',
      correctAnswer: { value: false },
      explanation:
        'Sai. "Will" dùng cho quyết định tức thì/dự đoán cảm tính; "be going to" dùng cho kế hoạch đã định/dự đoán có bằng chứng — hai ý nghĩa khác nhau.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành (quyết định tức thì): "I\'m thirsty. I _____ (get) some water."',
      correctAnswer: { accepted: ['will get'] },
      explanation: 'Quyết định vừa nghĩ ra ngay lúc nói dùng "will get".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'I will going to study tomorrow.' },
        { id: 'b', text: 'I am going to study tomorrow.' },
        { id: 'c', text: 'I will go to study tomorrow.' },
        { id: 'd', text: 'I am will study tomorrow.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Không kết hợp "will" và "going to" cùng lúc.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 23. Ngữ pháp cơ bản — Bài 23: Rút Gọn Mệnh Đề Quan Hệ
//    Source of truth: the lesson's own notes — active clause -> V-ing,
//    passive clause -> V-ed, omitting the relative pronoun as object.
// ---------------------------------------------------------------------------
const reducedRelativeClauses: SeedQuiz = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 23: Rút Gọn Mệnh Đề Quan Hệ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Rút gọn đúng của "The man who is standing there is my uncle." là gì?',
      options: [
        { id: 'a', text: 'The man stand there is my uncle.' },
        { id: 'b', text: 'The man standing there is my uncle.' },
        { id: 'c', text: 'The man stood there is my uncle.' },
        { id: 'd', text: 'The man to stand there is my uncle.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Mệnh đề quan hệ chủ động ("who is standing") rút gọn thành V-ing: "standing there".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Rút gọn đúng của "The book which was written by her is famous." là gì?',
      options: [
        { id: 'a', text: 'The book writing by her is famous.' },
        { id: 'b', text: 'The book written by her is famous.' },
        { id: 'c', text: 'The book write by her is famous.' },
        { id: 'd', text: 'The book to write by her is famous.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Mệnh đề quan hệ bị động ("which was written") rút gọn thành V-ed: "written by her".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Mệnh đề quan hệ ở dạng CHỦ ĐỘNG (who/which + V) được rút gọn thành dạng nào?',
      options: [
        { id: 'a', text: 'V-ing' },
        { id: 'b', text: 'V-ed' },
        { id: 'c', text: 'to V' },
        { id: 'd', text: 'V nguyên thể' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Mệnh đề chủ động rút gọn thành V-ing (phân từ hiện tại).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Mệnh đề quan hệ ở dạng bị động (who/which + be + V-ed) được rút gọn bằng cách giữ lại V-ed và bỏ "who/which + be".',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây chính là quy tắc rút gọn mệnh đề bị động.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Rút gọn mệnh đề quan hệ (đại từ quan hệ làm tân ngữ, có thể bỏ hẳn): "The car that she drives is new." → "The car _____ is new."',
      correctAnswer: { accepted: ['she drives'] },
      explanation:
        '"that" làm tân ngữ trong mệnh đề nên có thể bỏ hoàn toàn, giữ nguyên phần còn lại "she drives".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'The book wrote by her is famous.' },
        { id: 'b', text: 'The book written by her is famous.' },
        { id: 'c', text: 'The book writing by her is famous.' },
        { id: 'd', text: 'The book to write by her is famous.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Mệnh đề bị động rút gọn dùng V3 (past participle) "written", không phải "wrote".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 3(old). Ngữ pháp TOEIC — Bài 1: Từ loại
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
      difficulty: 'MEDIUM',
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
      difficulty: 'MEDIUM',
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
      difficulty: 'MEDIUM',
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
      difficulty: 'EASY',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trong câu tiếng Anh, tính từ thường đứng trước danh từ mà nó bổ nghĩa, còn trạng từ bổ nghĩa cho động từ, tính từ hoặc cả câu.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Đây là nguyên tắc nền tảng để làm câu hỏi từ loại: xác định chỗ trống đứng cạnh cái gì (danh từ → chọn tính từ; động từ/tính từ → chọn trạng từ).',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền đuôi từ (suffix) là dấu hiệu nhận biết phổ biến nhất của TRẠNG TỪ trong tiếng Anh (chỉ viết phần đuôi, ví dụ dạng "-xx"):',
      correctAnswer: { accepted: ['-ly', 'ly'] },
      explanation:
        'Đuôi "-ly" là dấu hiệu trạng từ phổ biến nhất (quickly, promptly, significantly). Lưu ý ngoại lệ: một số từ kết thúc bằng -ly lại là tính từ (friendly, costly, likely), nên vẫn phải xét vị trí trong câu.',
      difficulty: 'MEDIUM',
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
      difficulty: 'HARD',
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
      difficulty: 'EASY',
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
      difficulty: 'MEDIUM',
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
      difficulty: 'MEDIUM',
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
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền đại từ phản thân phù hợp: "She cut _____ while she was cooking dinner."',
      correctAnswer: { accepted: ['herself'] },
      explanation:
        'Khi chủ ngữ và tân ngữ là cùng một người, dùng ĐẠI TỪ PHẢN THÂN → "herself". Bảng tham chiếu: myself, yourself, himself, herself, itself, ourselves, yourselves, themselves.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Đại từ tân ngữ (me, him, her, us, them) đứng sau động từ hoặc sau giới từ.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Đây chính là quy tắc vị trí phân biệt đại từ chủ ngữ với đại từ tân ngữ, và là căn cứ để loại đáp án nhanh trong Part 5.',
      difficulty: 'EASY',
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
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Ngữ pháp TOEIC — Bài 3: To V1, V-ing, V1
//    Source of truth: the lesson's own notes (to-V1 verbs, V-ing verbs,
//    bare-infinitive after modals/causatives, the "enjoy to do" /
//    "want go" / "can playing" Common Mistakes).
// ---------------------------------------------------------------------------
const toeicGerundInfinitive: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 3: To V1, V-ing, V1',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'The manager decided _____ the meeting until next week.',
      options: [
        { id: 'a', text: 'to postpone' },
        { id: 'b', text: 'postponing' },
        { id: 'c', text: 'postpone' },
        { id: 'd', text: 'postponed' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"decide" luôn theo sau bởi TO V1 → "decided to postpone".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The team enjoys _____ new solutions to old problems.',
      options: [
        { id: 'a', text: 'to find' },
        { id: 'b', text: 'finding' },
        { id: 'c', text: 'find' },
        { id: 'd', text: 'found' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"enjoy" luôn theo sau bởi V-ING, không phải "to V1" → "enjoys finding".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Employees can _____ their vacation days at any time this year.',
      options: [
        { id: 'a', text: 'use' },
        { id: 'b', text: 'to use' },
        { id: 'c', text: 'using' },
        { id: 'd', text: 'used' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Sau động từ khuyết thiếu "can" luôn là V1 (bare infinitive), không "to" → "can use".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The supervisor made the interns _____ overtime last Friday.',
      options: [
        { id: 'a', text: 'work' },
        { id: 'b', text: 'to work' },
        { id: 'c', text: 'working' },
        { id: 'd', text: 'worked' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"make someone V1" (bare infinitive, không "to") — đây là mẫu câu khiến gây "bị bắt buộc làm gì" đã học.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'We need _____ the contract before Monday.',
      options: [
        { id: 'a', text: 'to sign' },
        { id: 'b', text: 'signing' },
        { id: 'c', text: 'sign' },
        { id: 'd', text: 'signed' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"need" luôn theo sau bởi TO V1 → "need to sign".',
      difficulty: 'EASY',
    },
    {
      type: 'TRUE_FALSE',
      content: "'Avoid' is followed by V-ing, not 'to V1' (e.g., 'avoid doing', not 'avoid to do').",
      correctAnswer: { value: true },
      explanation: 'Đúng. "avoid" nằm trong nhóm động từ theo sau bởi V-ing (enjoy, avoid, consider, suggest…).',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content: 'Complete: They suggested _____ (postpone) the launch date.',
      correctAnswer: { accepted: ['postponing'] },
      explanation: '"suggest" theo sau bởi V-ing → "suggested postponing".',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 6. Ngữ pháp TOEIC — Bài 4: Phân Từ
//    Source of truth: the lesson's own notes (V-ing = active/ongoing,
//    V-ed/3 = passive/completed, reduced relative clauses, the "broken
//    glass" vs "breaking glass" Common Mistake).
// ---------------------------------------------------------------------------
const participles: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 4: Phân Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'The employee _____ the annual conference has years of event-planning experience.',
      options: [
        { id: 'a', text: 'organizing' },
        { id: 'b', text: 'organized' },
        { id: 'c', text: 'organize' },
        { id: 'd', text: 'organizes' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Nhân viên là người CHỦ ĐỘNG thực hiện việc tổ chức → phân từ hiện tại "organizing" (= who organizes).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'All documents _____ before the deadline will be reviewed first.',
      options: [
        { id: 'a', text: 'submitting' },
        { id: 'b', text: 'submitted' },
        { id: 'c', text: 'submit' },
        { id: 'd', text: 'submits' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Tài liệu KHÔNG tự nộp mình — nó CHỊU TÁC ĐỘNG của việc nộp → phân từ quá khứ "submitted" (= that were submitted).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The machine _____ near the entrance needs to be repaired.',
      options: [
        { id: 'a', text: 'breaking' },
        { id: 'b', text: 'broken' },
        { id: 'c', text: 'break' },
        { id: 'd', text: 'breaks' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Máy ở trạng thái bị hỏng (chịu tác động) → phân từ quá khứ "broken", giống ví dụ "the broken chair" trong bài học.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Employees _____ in the customer service department must attend the training.',
      options: [
        { id: 'a', text: 'working' },
        { id: 'b', text: 'worked' },
        { id: 'c', text: 'work' },
        { id: 'd', text: 'works' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Nhân viên CHỦ ĐỘNG làm việc → phân từ hiện tại "working" (= who work).',
      difficulty: 'EASY',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'A present participle (V-ing) used as an adjective usually shows the noun performing the action, while a past participle (V-ed) usually shows the noun receiving the action.',
      correctAnswer: { value: true },
      explanation: 'Đúng. Đây là quy tắc cốt lõi để phân biệt phân từ hiện tại và phân từ quá khứ.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        "Reduce the clause: 'The report that was written by the finance team' → 'The report _____ by the finance team.'",
      correctAnswer: { accepted: ['written'] },
      explanation: 'Bỏ "that was", giữ lại phân từ quá khứ "written" (mệnh đề bị động rút gọn).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng, chú ý mệnh đề rút gọn bằng phân từ:',
      options: [
        { id: 's1', text: 'The proposal' },
        { id: 's2', text: 'submitted' },
        { id: 's3', text: 'last week' },
        { id: 's4', text: 'was approved' },
      ],
      correctAnswer: { orderedOptionIds: ['s1', 's2', 's3', 's4'] },
      explanation:
        '"The proposal (which was) submitted last week" — mệnh đề bị động rút gọn bổ nghĩa cho "The proposal", theo sau là động từ chính "was approved".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 7. Ngữ pháp TOEIC — Bài 5: So Sánh
//    Source of truth: the lesson's own notes (comparative -er/more,
//    superlative -est/most, equality as...as, the "more tall" / "He is
//    tallest" / "as better as" Common Mistakes). Business-context sentences,
//    distinct wording from Foundation Bài 20's own comparison quiz.
// ---------------------------------------------------------------------------
const toeicComparison: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 5: So Sánh',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: "This year's revenue was _____ than last year's.",
      options: [
        { id: 'a', text: 'higher' },
        { id: 'b', text: 'high' },
        { id: 'c', text: 'more high' },
        { id: 'd', text: 'highest' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Tính từ ngắn "high" + "-er" → "higher" trong so sánh hơn.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The new proposal is _____ than the previous one.',
      options: [
        { id: 'a', text: 'interesting' },
        { id: 'b', text: 'more interesting' },
        { id: 'c', text: 'interestinger' },
        { id: 'd', text: 'most interesting' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Tính từ dài "interesting" dùng "more" thay vì thêm đuôi → "more interesting".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Of all the candidates, she has _____ experience.',
      options: [
        { id: 'a', text: 'the most' },
        { id: 'b', text: 'more' },
        { id: 'c', text: 'most' },
        { id: 'd', text: 'the more' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'So sánh nhất cần "the" đứng trước → "the most experience".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Our new office is _____ as the old one in terms of space.',
      options: [
        { id: 'a', text: 'as large' },
        { id: 'b', text: 'larger' },
        { id: 'c', text: 'largest' },
        { id: 'd', text: 'more large' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Cấu trúc so sánh bằng: "as + adj + as" → "as large as".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "For adjectives with three or more syllables, we normally use 'more/most' instead of adding '-er/-est'.",
      correctAnswer: { value: true },
      explanation: 'Đúng. Tính từ dài (từ 3 âm tiết trở lên) dùng more/most thay vì thêm đuôi.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content: 'Complete: This model is _____ (good) than the previous version.',
      correctAnswer: { accepted: ['better'] },
      explanation: '"good" là tính từ bất quy tắc: good → better → best.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng theo cấu trúc so sánh nhất:',
      options: [
        { id: 't1', text: 'This laptop' },
        { id: 't2', text: 'is' },
        { id: 't3', text: 'the most reliable' },
        { id: 't4', text: 'in its class' },
      ],
      correctAnswer: { orderedOptionIds: ['t1', 't2', 't3', 't4'] },
      explanation: 'S + V + the most + adj + phạm vi so sánh ("in its class").',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 8. Ngữ pháp TOEIC — Bài 6: Câu Bị Động
//    Source of truth: the lesson's own notes (Passive = S + be + V-ed/3 [+
//    by + O], the 4 taught tense forms, when to drop "by + agent", the
//    "write yesterday" / "is write" / over-using "by" Common Mistakes).
// ---------------------------------------------------------------------------
const toeicPassiveVoice: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 6: Câu Bị Động',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The new policy _____ by the HR department last month.',
      options: [
        { id: 'a', text: 'was announced' },
        { id: 'b', text: 'announced' },
        { id: 'c', text: 'is announced' },
        { id: 'd', text: 'announce' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Bị động thì quá khứ đơn: was/were + V-ed/3 → "was announced".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Meeting minutes _____ within 24 hours after every meeting.',
      options: [
        { id: 'a', text: 'are distributed' },
        { id: 'b', text: 'distribute' },
        { id: 'c', text: 'is distributed' },
        { id: 'd', text: 'distributed' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Chủ ngữ số nhiều "Meeting minutes" + bị động thì hiện tại đơn: am/is/are + V-ed/3 → "are distributed".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The office _____ currently being renovated.',
      options: [
        { id: 'a', text: 'is' },
        { id: 'b', text: 'are' },
        { id: 'c', text: 'was' },
        { id: 'd', text: 'be' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Bị động thì hiện tại tiếp diễn: am/is/are + being + V-ed/3. Chủ ngữ số ít "the office" → "is being renovated".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The contract _____ by both parties yet.',
      options: [
        { id: 'a', text: "hasn't been signed" },
        { id: 'b', text: "didn't sign" },
        { id: 'c', text: "isn't signed" },
        { id: 'd', text: "hasn't signed" },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Bị động thì hiện tại hoàn thành: have/has + been + V-ed/3, ở dạng phủ định với "yet" → "hasn\'t been signed".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'English _____ widely in international business meetings.',
      options: [
        { id: 'a', text: 'is spoken' },
        { id: 'b', text: 'speaks' },
        { id: 'c', text: 'spoken' },
        { id: 'd', text: 'speak' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Bị động thì hiện tại đơn: am/is/are + V-ed/3 → "is spoken".',
      difficulty: 'EASY',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "In passive voice, 'by + agent' can be omitted when the performer of the action is unknown or unimportant.",
      correctAnswer: { value: true },
      explanation: 'Đúng. Đây là quy tắc đã học: chỉ giữ "by + agent" khi cần nhấn mạnh người thực hiện.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        "Change to passive: 'The technician repaired the printer yesterday.' → 'The printer _____ (repair) yesterday.'",
      correctAnswer: { accepted: ['was repaired'] },
      explanation: 'Quá khứ đơn chủ động → bị động: was/were + V-ed/3 → "was repaired".',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 9. Ngữ pháp TOEIC — Bài 7: Câu Điều Kiện
//    Source of truth: the lesson's own notes (4 conditional types, "unless"
//    = "if not", the "If I will go" / mixing type 2-3 Common Mistakes).
// ---------------------------------------------------------------------------
const toeicConditionals: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 7: Câu Điều Kiện',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If the price _____ below $50, more customers will buy the product.',
      options: [
        { id: 'a', text: 'drops' },
        { id: 'b', text: 'dropped' },
        { id: 'c', text: 'will drop' },
        { id: 'd', text: 'had dropped' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Loại 1: If + hiện tại đơn, S + will + V → mệnh đề "if" dùng "drops".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If you heat water to 100°C, it _____.',
      options: [
        { id: 'a', text: 'boils' },
        { id: 'b', text: 'will boil' },
        { id: 'c', text: 'boiled' },
        { id: 'd', text: 'would boil' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Loại 0: If + hiện tại đơn, S + hiện tại đơn → diễn tả sự thật hiển nhiên.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If I _____ the CEO, I would relocate the headquarters.',
      options: [
        { id: 'a', text: 'were' },
        { id: 'b', text: 'was' },
        { id: 'c', text: 'am' },
        { id: 'd', text: 'will be' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Loại 2: If + quá khứ đơn, S + would + V — với động từ "to be", dùng "were" cho mọi chủ ngữ (kể cả "I").',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If the team _____ harder last quarter, they would have hit their sales target.',
      options: [
        { id: 'a', text: 'had worked' },
        { id: 'b', text: 'worked' },
        { id: 'c', text: 'works' },
        { id: 'd', text: 'would work' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Loại 3: If + quá khứ hoàn thành, S + would have + V-ed/3 → mệnh đề "if" dùng "had worked".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ you submit the report by Friday, the client will be very unhappy.',
      options: [
        { id: 'a', text: 'Unless' },
        { id: 'b', text: 'If' },
        { id: 'c', text: 'Even if' },
        { id: 'd', text: 'Because' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"Unless" = "if not" → "Unless you submit..." = "If you don\'t submit...".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Conditional sentences types 2 and 3 both describe unreal or hypothetical situations, but type 2 is about the present/future while type 3 is about the past.',
      correctAnswer: { value: true },
      explanation: 'Đúng. Đây là điểm phân biệt cốt lõi giữa loại 2 (giả định hiện tại) và loại 3 (giả định quá khứ).',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content: 'Complete: If she _____ (know) about the meeting earlier, she would have attended.',
      correctAnswer: { accepted: ['had known'] },
      explanation: 'Loại 3: If + quá khứ hoàn thành → "had known".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 10. Ngữ pháp TOEIC — Bài 8: Mệnh Đề Quan Hệ
//     Source of truth: the lesson's own notes (who/which/that/whose/where/
//     when, defining vs non-defining, the comma + "that in non-defining"
//     Common Mistakes).
// ---------------------------------------------------------------------------
const relativeClauses: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 8: Mệnh Đề Quan Hệ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The employee _____ won the award works in the sales department.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whose' },
        { id: 'd', text: 'where' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"who" thay cho người, làm chủ ngữ của mệnh đề quan hệ.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The product _____ we launched last month has exceeded sales expectations.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whose' },
        { id: 'd', text: 'when' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"which" thay cho vật ("the product").',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The manager _____ office is next to the elevator called a team meeting.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whose' },
        { id: 'd', text: 'where' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"whose" chỉ sở hữu — văn phòng CỦA người quản lý.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This is the conference room _____ we hold our weekly meetings.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'where' },
        { id: 'd', text: 'when' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"where" chỉ nơi chốn ("the conference room").',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Mr. Lee, _____ has worked here for ten years, will lead the new project.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'that' },
        { id: 'c', text: 'which' },
        { id: 'd', text: 'whom' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Mệnh đề không xác định (có dấu phẩy) dùng "who" cho người — không bao giờ dùng "that" trong mệnh đề không xác định.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "'That' can be used instead of 'who' or 'which' in a non-defining relative clause (one set off by commas).",
      correctAnswer: { value: false },
      explanation: 'Sai. "that" không được dùng trong mệnh đề không xác định (non-defining), chỉ dùng trong mệnh đề xác định (defining).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Complete: 2015 was the year _____ the company went public.',
      correctAnswer: { accepted: ['when'] },
      explanation: '"when" chỉ thời gian ("the year").',
      difficulty: 'EASY',
    },
  ],
};

// ---------------------------------------------------------------------------
// 11. Ngữ pháp TOEIC — Bài 9: Giới Từ
//     Source of truth: the lesson's own notes (time/place/means prepositions,
//     the at/on/in distinction, by vs with, fixed collocations like
//     "interested in").
// ---------------------------------------------------------------------------
const prepositions: SeedQuiz = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 9 : Giới Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The meeting is scheduled for 9 AM _____ Monday.',
      options: [
        { id: 'a', text: 'on' },
        { id: 'b', text: 'at' },
        { id: 'c', text: 'in' },
        { id: 'd', text: 'for' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"on" dùng cho ngày trong tuần → "on Monday".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The company was founded _____ 1998.',
      options: [
        { id: 'a', text: 'in' },
        { id: 'b', text: 'on' },
        { id: 'c', text: 'at' },
        { id: 'd', text: 'since' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"in" dùng cho năm → "in 1998".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She has worked here _____ five years.',
      options: [
        { id: 'a', text: 'for' },
        { id: 'b', text: 'since' },
        { id: 'c', text: 'during' },
        { id: 'd', text: 'in' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"for" dùng cho một KHOẢNG THỜI GIAN → "for five years".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He has worked here _____ 2015.',
      options: [
        { id: 'a', text: 'since' },
        { id: 'b', text: 'for' },
        { id: 'c', text: 'during' },
        { id: 'd', text: 'from' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"since" dùng cho một MỐC THỜI GIAN bắt đầu → "since 2015".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The contract was signed _____ both parties.',
      options: [
        { id: 'a', text: 'by' },
        { id: 'b', text: 'with' },
        { id: 'c', text: 'for' },
        { id: 'd', text: 'about' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"by" chỉ TÁC NHÂN trong câu bị động ("was signed BY both parties"), khác với "with" chỉ công cụ/phương tiện.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "'At' is typically used for specific points in time (e.g., at 9 AM), 'on' for days and dates, and 'in' for months, years, and longer periods.",
      correctAnswer: { value: true },
      explanation: 'Đúng. Đây là nguyên tắc phân loại giới từ thời gian đã học.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content: 'Complete with the correct preposition: She is very interested _____ marketing and advertising.',
      correctAnswer: { accepted: ['in'] },
      explanation: 'Cụm cố định "interested in" đã học.',
      difficulty: 'MEDIUM',
    },
  ],
};

const SEEDS: SeedQuiz[] = [
  sentenceStructure,
  toBeVerb,
  basicNouns,
  regularVerbs,
  basicAdjectives,
  adjectiveOrder,
  ingEdAdjectives,
  adverbs,
  articles,
  gerundInfinitive,
  quantifiers,
  presentSimpleTense,
  pastSimpleTense,
  presentContinuousTense,
  presentPerfectTense,
  pastPerfectTense,
  passiveVoice,
  conditionals,
  comparisonTense,
  relativePronouns,
  willVsGoingTo,
  reducedRelativeClauses,
  partsOfSpeech,
  pronouns,
  toeicGerundInfinitive,
  participles,
  toeicComparison,
  toeicPassiveVoice,
  toeicConditionals,
  relativeClauses,
  prepositions,
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
          difficulty: question.difficulty,
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
