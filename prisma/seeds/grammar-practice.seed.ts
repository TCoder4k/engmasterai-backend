import { Prisma, PrismaClient, QuestionType, QuestionDifficulty } from '@prisma/client';
import { validateQuestionContent } from '../../src/lesson/quiz/grade-question';

// Seed script for Grammar lessons' Advanced Practice (LessonTask type
// PRACTICE) — the sibling of grammar-quizzes.seed.ts, same idempotent
// pattern: matches each lesson by its exact title, reuses (never recreates)
// its PRACTICE LessonTask so existing LessonTaskProgress rows keep their
// foreign key, then replaces that task's question list wholesale. Re-running
// produces the same result.
//
// Every question is validated through the API's own validateQuestionContent()
// before any write.
//
// Advanced Practice is NOT "the quiz but longer" — every question here
// requires deeper/more contextual application of the SAME concepts the
// lesson's quiz checks for direct recall, never a concept the lesson does
// not teach.
//
// Run with:  npm run seed:grammar-practice

const prisma = new PrismaClient();

interface SeedQuestion {
  type: QuestionType;
  content: string;
  options?: { id: string; text: string }[];
  correctAnswer: unknown;
  explanation: string;
  difficulty: QuestionDifficulty;
}

interface SeedPractice {
  lessonTitle: string;
  passingScorePercent: number;
  questions: SeedQuestion[];
}

// ---------------------------------------------------------------------------
// 1. Ngữ pháp cơ bản — Bài 1: Cấu trúc câu Tiếng Anh
//    Source of truth: the lesson's own notes (S/V/O/C/A, the 5 sentence
//    patterns, the "minimum S+V" rule, the adverb-placement mistake).
//
//    REPLACES 3 pre-existing PRACTICE questions that tested inversion,
//    mixed conditionals and cleft sentences — none of which this lesson
//    teaches. Flagged in the accompanying audit report as a pre-existing
//    content-alignment bug, not something introduced by this seed.
// ---------------------------------------------------------------------------
const sentenceStructure: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 1: Cấu trúc câu Tiếng Anh',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Our new manager seems very confident during meetings. Câu này thuộc cấu trúc nào?',
      options: [
        { id: 'svo', text: 'S + V + O' },
        { id: 'svc', text: 'S + V + C' },
        { id: 'svoc', text: 'S + V + O + C' },
        { id: 'svoo', text: 'S + V + O1 + O2' },
      ],
      correctAnswer: { optionId: 'svc' },
      explanation:
        '"seems" là động từ nối, theo sau là "confident" — tính từ mô tả lại chủ ngữ "Our new manager". Đây là S + V + C, không phải S + V + O vì "confident" không phải là một sự vật/sự việc bị tác động.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'The company sent every employee a holiday bonus. Câu này thuộc cấu trúc nào?',
      options: [
        { id: 'svoc', text: 'S + V + O + C' },
        { id: 'svoo', text: 'S + V + O1 + O2' },
        { id: 'svc', text: 'S + V + C' },
        { id: 'svo', text: 'S + V + O' },
      ],
      correctAnswer: { optionId: 'svoo' },
      explanation:
        '"every employee" (người nhận — O1) và "a holiday bonus" (vật được gửi — O2) đều là tân ngữ, không phải bổ ngữ mô tả nhau. Đây là S + V + O1 + O2, khác với S + V + O + C (nơi C mô tả lại O, như "made him happy").',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'Rings the phone loudly.' },
        { id: 'b', text: 'The phone rings loudly.' },
        { id: 'c', text: 'Loudly rings the phone.' },
        { id: 'd', text: 'The phone loudly rings.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Một câu tối thiểu cần S + V đúng thứ tự: "The phone" (S) + "rings" (V), sau đó trạng ngữ cách thức "loudly" đứng sau động từ. Các phương án còn lại thiếu chủ ngữ đứng trước động từ hoặc đặt trạng ngữ sai vị trí.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu theo cấu trúc S + V + C: "This coffee _____ (taste) too bitter for me."',
      correctAnswer: { accepted: ['tastes'] },
      explanation:
        '"This coffee" là chủ ngữ số ít, "taste" là động từ nối nên chia -s: "tastes", theo sau là bổ ngữ "too bitter" mô tả lại chủ ngữ.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn câu viết đúng vị trí trạng ngữ:',
      options: [
        { id: 'a', text: 'She very enjoys her job.' },
        { id: 'b', text: 'She enjoys her job very much.' },
        { id: 'c', text: 'She enjoys very her job.' },
        { id: 'd', text: 'Very she enjoys her job.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"very" không đứng trực tiếp trước động từ thường. Muốn nhấn mạnh mức độ, dùng "very much" đặt cuối câu, sau tân ngữ: "enjoys her job very much."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng theo cấu trúc S + V + O + C:',
      options: [
        { id: 't1', text: 'The team' },
        { id: 't2', text: 'considers' },
        { id: 't3', text: 'the project' },
        { id: 't4', text: 'successful' },
      ],
      correctAnswer: { orderedOptionIds: ['t1', 't2', 't3', 't4'] },
      explanation:
        'S (The team) + V (considers) + O (the project) + C (successful — tính từ mô tả lại "the project", không phải một tân ngữ thứ hai).',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trong câu "The manager gave the client a discount.", cụm "the client" là Bổ ngữ (C) của câu.',
      correctAnswer: { value: false },
      explanation:
        'Sai. "the client" là Tân ngữ gián tiếp (O1 — người nhận), và "a discount" là Tân ngữ trực tiếp (O2 — vật được cho). Câu này theo cấu trúc S + V + O1 + O2. Bổ ngữ (C) chỉ xuất hiện sau động từ nối hoặc mô tả lại một tân ngữ, như trong "made him happy".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "By the end of the meeting, the whole team _____ exhausted.",
      options: [
        { id: 'a', text: 'worked' },
        { id: 'b', text: 'looked' },
        { id: 'c', text: 'walked' },
        { id: 'd', text: 'discussed' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Chỗ trống theo sau là tính từ "exhausted" — cần một ĐỘNG TỪ NỐI để dẫn vào bổ ngữ (S + V + C). "looked" là động từ nối (= seemed). "worked", "walked", "discussed" đều là động từ hành động, không thể trực tiếp lấy tính từ làm bổ ngữ theo cách này.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây SAI về trật tự từ?',
      options: [
        { id: 'a', text: 'He told me the truth.' },
        { id: 'b', text: 'He told the truth me.' },
        { id: 'c', text: "She made her team proud." },
        { id: 'd', text: 'They call him a hero.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Trong cấu trúc S + V + O1 + O2 (không có giới từ "to"), tân ngữ gián tiếp (người nhận — "me") luôn đứng TRƯỚC tân ngữ trực tiếp ("the truth"). Câu (b) đảo ngược thứ tự nên sai; câu đúng là "He told me the truth."',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Ngữ pháp cơ bản — Bài 2: Động từ Tobe
//    Source of truth: the lesson's own notes (to be conjugation by subject,
//    regular-verb present simple, negative/question formation for both,
//    the "one main verb only" mistake).
//
//    REPLACES 3 pre-existing PRACTICE questions that tested subject-verb
//    agreement with correlative conjunctions and collective nouns — far
//    beyond what this Foundation lesson teaches. Same pre-existing bug as
//    Bài 1, flagged in the audit report.
// ---------------------------------------------------------------------------
const toBeVerb: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 2: Động từ Tobe',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'My sister _____ at a hospital, and she _____ very dedicated to her patients.',
      options: [
        { id: 'a', text: 'work / is' },
        { id: 'b', text: 'works / is' },
        { id: 'c', text: 'works / are' },
        { id: 'd', text: 'work / are' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Hai mệnh đề dùng hai loại động từ khác nhau: "works" là động từ thường, chủ ngữ "she" (ngôi 3 số ít) nên thêm -s; "is" là động từ to be, cũng chia theo "she" → is.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Xác định câu chia động từ to be đúng:',
      options: [
        { id: 'a', text: 'The manager are usually busy on Mondays.' },
        { id: 'b', text: 'The manager is usually busy on Mondays.' },
        { id: 'c', text: 'The manager do busy on Mondays.' },
        { id: 'd', text: 'The manager busy on Mondays.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"The manager" là danh từ số ít nên dùng "is", không dùng "are". Câu (c) và (d) sai vì thiếu hoặc dùng nhầm động từ chính — vị ngữ "busy" là tính từ nên bắt buộc phải có to be, không dùng "do".',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền dạng phủ định đúng: "They _____ (not / live) in this city anymore."',
      correctAnswer: { accepted: ["don't live", 'do not live', 'dont live'] },
      explanation:
        '"live" là động từ thường, chủ ngữ "They" nên mượn trợ động từ "don\'t" (= do not) + động từ nguyên thể: "don\'t live".',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền dạng phủ định đúng: "She _____ (not / be) ready for the interview yet."',
      correctAnswer: { accepted: ["isn't ready", 'is not ready', 'isnt ready'] },
      explanation:
        'Vị ngữ là to be nên phủ định bằng cách thêm "not" ngay sau "is": "isn\'t ready". Không dùng "doesn\'t" vì đây không phải động từ thường.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu hỏi nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'Does she works on weekends?' },
        { id: 'b', text: 'Do she works on weekends?' },
        { id: 'c', text: 'Does she work on weekends?' },
        { id: 'd', text: 'Is she works on weekends?' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"work" là động từ thường nên câu hỏi mượn "Does" (vì "she" là ngôi 3 số ít), và sau "does" động từ chính phải trở về dạng NGUYÊN THỂ — "work", không phải "works". "Does she works" là lỗi chia động từ hai lần rất phổ biến.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây SAI ngữ pháp?',
      options: [
        { id: 'a', text: "He isn't at the office today." },
        { id: 'b', text: "He doesn't at the office today." },
        { id: 'c', text: "He doesn't work today." },
        { id: 'd', text: 'Is he at the office today?' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"doesn\'t" chỉ dùng để phủ định ĐỘNG TỪ THƯỜNG, nhưng câu (b) không có động từ thường nào sau nó ("at the office" là cụm giới từ, không phải động từ). Vị ngữ ở đây thực chất là to be, nên phải viết "He isn\'t at the office today."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trong câu "Are you a teacher?", từ "Are" đóng vai trò trợ động từ mượn để hỏi, giống như "Do" trong câu hỏi động từ thường.',
      correctAnswer: { value: false },
      explanation:
        'Sai. "Are" ở đây CHÍNH LÀ động từ to be của câu, chỉ đơn giản đảo lên trước chủ ngữ để hỏi — nó không phải "mượn" từ đâu cả. Đây khác bản chất với "Do/Does" của động từ thường, vốn là một trợ động từ được thêm vào vì bản thân động từ thường không tự đảo được.',
      difficulty: 'HARD',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp thành câu phủ định đúng với động từ thường:',
      options: [
        { id: 'p1', text: 'My colleagues' },
        { id: 'p2', text: "don't" },
        { id: 'p3', text: 'attend' },
        { id: 'p4', text: 'the meeting' },
      ],
      correctAnswer: { orderedOptionIds: ['p1', 'p2', 'p3', 'p4'] },
      explanation:
        'S (My colleagues) + do/does + not (don\'t, vì chủ ngữ số nhiều) + V nguyên thể (attend) + O (the meeting). Sau "don\'t" động từ luôn ở dạng nguyên thể, không thêm -s.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "A: \"_____ you free this afternoon?\" B: \"No, I _____ a report to finish.\"",
      options: [
        { id: 'a', text: 'Are / have' },
        { id: 'b', text: 'Do / am' },
        { id: 'c', text: 'Are / am' },
        { id: 'd', text: 'Do / have' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Hai câu dùng hai loại động từ khác nhau: "free" là tính từ nên câu hỏi dùng to be — "Are you free?"; "have" là động từ thường nên câu trả lời chia bình thường theo "I" — "I have a report...", không cần "am".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Ngữ pháp cơ bản — Bài 3: Danh Từ Tiếng Anh Cơ Bản
// ---------------------------------------------------------------------------
const basicNouns: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 3: Danh Từ Tiếng Anh Cơ Bản',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'Informations are useful.' },
        { id: 'b', text: 'Information is useful.' },
        { id: 'c', text: 'Information are useful.' },
        { id: 'd', text: 'Informations is useful.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"information" là danh từ không đếm được: không có dạng số nhiều "informations", và luôn đi với động từ số ít "is".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn câu đúng: "There are five _____ on the table."',
      options: [
        { id: 'a', text: 'book' },
        { id: 'b', text: 'books' },
        { id: 'c', text: 'a book' },
        { id: 'd', text: 'the books' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Sau số đếm lớn hơn 1 ("five"), danh từ đếm được phải ở dạng số nhiều: "books".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "We don't have _____ information about the new policy yet.",
      options: [
        { id: 'a', text: 'many' },
        { id: 'b', text: 'much' },
        { id: 'c', text: 'a' },
        { id: 'd', text: 'an' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"information" không đếm được nên dùng "much" trong câu phủ định, không dùng "many" (chỉ cho danh từ đếm được số nhiều).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        '"Money" là danh từ không đếm được, nên không có dạng số nhiều "moneys".',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Giống "information" và "water", "money" là danh từ không đếm được: không thêm -s, và dùng "much" chứ không dùng "many".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây SAI ngữ pháp?',
      options: [
        { id: 'a', text: 'She has a cat.' },
        { id: 'b', text: 'She has a cats.' },
        { id: 'c', text: 'They have two cats.' },
        { id: 'd', text: 'I need some water.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"a" chỉ dùng với danh từ đếm được SỐ ÍT. "a cats" sai vì "cats" là số nhiều — phải viết "a cat" hoặc "some cats".',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Chia danh từ "apple" sang số nhiều: "I ate three _____ today."',
      correctAnswer: { accepted: ['apples'] },
      explanation: 'Danh từ đếm được số nhiều thêm "-s": apple → apples.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the correct sentence.',
      options: [
        { id: 'a', text: 'He gave me an advices.' },
        { id: 'b', text: 'He gave me some advice.' },
        { id: 'c', text: 'He gave me an advice.' },
        { id: 'd', text: 'He gave me some advices.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"advice" (lời khuyên) là danh từ không đếm được, giống "information" và "money": không có dạng số nhiều "advices" và không dùng mạo từ "an" trước nó — dùng "some advice".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the correctly written sentence.',
      options: [
        { id: 'a', text: 'There is many student in the class.' },
        { id: 'b', text: 'There are many students in the class.' },
        { id: 'c', text: 'There is many students in the class.' },
        { id: 'd', text: 'There are many student in the class.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"many" đi với danh từ đếm được số nhiều "students", và động từ phải khớp số nhiều "are" — cả danh từ và động từ đều phải nhất quán số nhiều.',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Ngữ pháp cơ bản — Bài 4: Động từ thường
// ---------------------------------------------------------------------------
const regularVerbs: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 4: Động từ thường',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng đúng: "My colleague _____ English fluently."',
      options: [
        { id: 'a', text: 'speak' },
        { id: 'b', text: 'speaks' },
        { id: 'c', text: 'speaking' },
        { id: 'd', text: 'spoke' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"My colleague" là ngôi thứ ba số ít nên động từ thêm -s: "speaks".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Chọn dạng đúng: "_____ your sister live near the office?"',
      options: [
        { id: 'a', text: 'Do' },
        { id: 'b', text: 'Does' },
        { id: 'c', text: 'Is' },
        { id: 'd', text: 'Are' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"your sister" là ngôi thứ ba số ít nên câu hỏi động từ thường dùng "Does".',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Chia đúng động từ "watch" theo ngôi "she": "She _____ a movie every Friday."',
      correctAnswer: { accepted: ['watches'] },
      explanation:
        'Động từ tận cùng bằng -ch thêm "-es" chứ không chỉ "-s": watch → watches.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: "She don't like coffee." },
        { id: 'b', text: "She doesn't like coffee." },
        { id: 'c', text: "She doesn't likes coffee." },
        { id: 'd', text: 'She not like coffee.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"She" dùng trợ động từ "doesn\'t", không dùng "don\'t". Câu (c) sai vì sau "doesn\'t" động từ chính phải về dạng nguyên thể "like", không giữ "-s".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'A: "What time _____ the shop open?" B: "It _____ at 8 AM."',
      options: [
        { id: 'a', text: 'Does / opens' },
        { id: 'b', text: 'Do / open' },
        { id: 'c', text: 'Does / open' },
        { id: 'd', text: 'Do / opens' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Câu hỏi với "the shop" (số ít) dùng "Does"; câu trả lời khẳng định với "It" (số ít) phải thêm -s vào động từ chính: "opens".',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Trong câu phủ định với động từ thường, sau "doesn\'t" động từ chính KHÔNG thêm -s.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. "doesn\'t" đã mang -s rồi, nên động từ theo sau trở về dạng nguyên thể: "doesn\'t like", không phải "doesn\'t likes".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu phủ định đúng:',
      options: [
        { id: 'q1', text: 'My brother' },
        { id: 'q2', text: "doesn't" },
        { id: 'q3', text: 'eat' },
        { id: 'q4', text: 'meat' },
      ],
      correctAnswer: { orderedOptionIds: ['q1', 'q2', 'q3', 'q4'] },
      explanation:
        'S (My brother — số ít) + doesn\'t + V nguyên thể (eat) + O (meat).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with NO grammar mistake.',
      options: [
        { id: 'a', text: 'Does she goes to school by bus?' },
        { id: 'b', text: 'Does she go to school by bus?' },
        { id: 'c', text: 'Do she goes to school by bus?' },
        { id: 'd', text: 'Do she go to school by bus?' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"she" cần trợ động từ "Does", và sau "Does" động từ chính phải về nguyên thể "go", không phải "goes".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Ngữ pháp cơ bản — Bài 5: Tính Từ Tiếng Anh Cơ Bản
// ---------------------------------------------------------------------------
const basicAdjectives: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 5: Tính Từ Tiếng Anh Cơ Bản',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: "Her new phone is _____ than mine.",
      options: [
        { id: 'a', text: 'expensive' },
        { id: 'b', text: 'more expensive' },
        { id: 'c', text: 'expensiver' },
        { id: 'd', text: 'most expensive' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"expensive" là tính từ dài nên so sánh hơn dùng "more", không thêm đuôi "-er".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This is _____ movie I have ever seen.',
      options: [
        { id: 'a', text: 'interesting' },
        { id: 'b', text: 'more interesting' },
        { id: 'c', text: 'the most interesting' },
        { id: 'd', text: 'interestinger' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'So sánh nhất với tính từ dài dùng "the most + adj". Đây không phải so sánh giữa hai vật ("more") mà là mức cao nhất trong tất cả các phim đã xem.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền dạng so sánh nhất của "good" (bất quy tắc): "He is the _____ player on the team."',
      correctAnswer: { accepted: ['best'] },
      explanation:
        '"good" là tính từ bất quy tắc: good → better → best, không thêm "-est" hay "most".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the correct sentence.',
      options: [
        { id: 'a', text: 'This dress is beautifuler than that one.' },
        { id: 'b', text: 'This dress is more beautiful than that one.' },
        { id: 'c', text: 'This dress is beautiful more than that one.' },
        { id: 'd', text: 'This dress is the beautiful.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"beautiful" là tính từ dài nên so sánh hơn dùng "more beautiful", đặt ngay trước tính từ.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Among the three candidates, Mr. Lee is _____ qualified for the position.',
      options: [
        { id: 'a', text: 'more' },
        { id: 'b', text: 'most' },
        { id: 'c', text: 'the more' },
        { id: 'd', text: 'the most' },
      ],
      correctAnswer: { optionId: 'd' },
      explanation:
        'So sánh giữa BA người trở lên (không chỉ hai) cần so sánh NHẤT: "the most qualified", luôn có "the" đi kèm.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Tính từ ngắn (1-2 âm tiết) thường thêm "-er"/"-est" để so sánh, còn tính từ dài (từ 3 âm tiết trở lên) dùng "more"/"most".',
      correctAnswer: { value: true },
      explanation: 'Đúng — đây là quy tắc cốt lõi để chọn giữa hai cách so sánh.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu so sánh đúng (dùng dạng bất quy tắc của "good"):',
      options: [
        { id: 'r1', text: 'This laptop' },
        { id: 'r2', text: 'is' },
        { id: 'r3', text: 'better' },
        { id: 'r4', text: 'than that one' },
      ],
      correctAnswer: { orderedOptionIds: ['r1', 'r2', 'r3', 'r4'] },
      explanation:
        '"good" so sánh hơn là "better" (bất quy tắc, không phải "gooder" hay "more good").',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the correct sentence.',
      options: [
        { id: 'a', text: 'The soup taste is spicy.' },
        { id: 'b', text: 'The soup is spicy.' },
        { id: 'c', text: 'The soup spicy is.' },
        { id: 'd', text: 'The soup very spicy.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Tính từ "spicy" cần một động từ TO BE để làm vị ngữ, mô tả chủ ngữ: "The soup is spicy." Câu (d) thiếu hẳn động từ "is" nên không thành câu hoàn chỉnh; câu (a) và (c) có động từ nhưng sai vị trí/dùng thừa động từ.',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 6. Ngữ pháp cơ bản — Bài 6: Trật Tự Tính Từ
// ---------------------------------------------------------------------------
const adjectiveOrder: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 6: Trật Tự Tính Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I bought a _____ jacket.',
      options: [
        { id: 'a', text: 'nice black' },
        { id: 'b', text: 'black nice' },
        { id: 'c', text: 'nice black leather' },
        { id: 'd', text: 'black leather nice' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Opinion (nice) đứng trước Color (black): "a nice black jacket".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This is a _____ chair.',
      options: [
        { id: 'a', text: 'big wooden' },
        { id: 'b', text: 'wooden big' },
        { id: 'c', text: 'chair big wooden' },
        { id: 'd', text: 'big chair wooden' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Size (big) đứng trước Material (wooden): "a big wooden chair".',
      difficulty: 'EASY',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp đúng trật tự (Ý kiến → Kích thước → Màu sắc → Danh từ):',
      options: [
        { id: 'v1', text: 'beautiful' },
        { id: 'v2', text: 'small' },
        { id: 'v3', text: 'blue' },
        { id: 'v4', text: 'vase' },
      ],
      correctAnswer: { orderedOptionIds: ['v1', 'v2', 'v3', 'v4'] },
      explanation: 'Opinion (beautiful) → Size (small) → Color (blue) → Noun (vase).',
      difficulty: 'MEDIUM',
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
    {
      type: 'TRUE_FALSE',
      content:
        'Trong tiếng Anh, tính từ chỉ Chất liệu (Material) luôn đứng SAU tính từ chỉ Nguồn gốc (Origin).',
      correctAnswer: { value: true },
      explanation:
        'Đúng, theo trật tự Opinion – Size – Shape – Color – Origin – Material – Purpose – Noun, Origin luôn đứng trước Material.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She was wearing an _____ dress.',
      options: [
        { id: 'a', text: 'elegant red silk' },
        { id: 'b', text: 'silk red elegant' },
        { id: 'c', text: 'red elegant silk' },
        { id: 'd', text: 'silk elegant red' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Opinion (elegant) → Color (red) → Material (silk): "an elegant red silk dress".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He bought a _____ vase.',
      options: [
        { id: 'a', text: 'Chinese porcelain' },
        { id: 'b', text: 'porcelain Chinese' },
        { id: 'c', text: 'vase Chinese porcelain' },
        { id: 'd', text: 'Chinese vase porcelain' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Origin (Chinese) đứng trước Material (porcelain): "Chinese porcelain vase".',
      difficulty: 'HARD',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp đúng trật tự (Ý kiến → Hình dạng → Màu sắc → Nguồn gốc → Danh từ):',
      options: [
        { id: 'h1', text: 'lovely' },
        { id: 'h2', text: 'round' },
        { id: 'h3', text: 'green' },
        { id: 'h4', text: 'Vietnamese' },
        { id: 'h5', text: 'hat' },
      ],
      correctAnswer: { orderedOptionIds: ['h1', 'h2', 'h3', 'h4', 'h5'] },
      explanation:
        'Opinion (lovely) → Shape (round) → Color (green) → Origin (Vietnamese) → Noun (hat).',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 7. Ngữ pháp cơ bản — Bài 7: Tính Từ Đuôi -ing và -ed
// ---------------------------------------------------------------------------
const ingEdAdjectives: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 7: Tính Từ Đuôi ing và ed',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This book is really _____.',
      options: [
        { id: 'a', text: 'exciting' },
        { id: 'b', text: 'excited' },
        { id: 'c', text: 'excite' },
        { id: 'd', text: 'excites' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"The book" gây ra cảm giác hào hứng, nên dùng đuôi -ing: "exciting".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I feel very _____ about the trip.',
      options: [
        { id: 'a', text: 'exciting' },
        { id: 'b', text: 'excited' },
        { id: 'c', text: 'excite' },
        { id: 'd', text: 'excites' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"I" là người CẢM THẤY hào hứng, nên dùng đuôi -ed: "excited".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'The news was very shocked.' },
        { id: 'b', text: 'The news was very shocking.' },
        { id: 'c', text: 'I was shocking to hear the news.' },
        { id: 'd', text: 'I shocking about the news.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"The news" là sự việc gây ra cảm giác sốc, nên dùng đuôi -ing: "shocking". Câu (c) sai vì "I" (người cảm thấy) phải dùng "shocked".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền đúng dạng của "surprise": "The test results were _____ — nobody expected such high scores."',
      correctAnswer: { accepted: ['surprising'] },
      explanation:
        '"The test results" là sự việc gây ra sự ngạc nhiên, nên dùng đuôi -ing: "surprising".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Điền đúng dạng của "surprise": "Everyone was _____ by the test results."',
      correctAnswer: { accepted: ['surprised'] },
      explanation:
        '"Everyone" là người CẢM THẤY ngạc nhiên, nên dùng đuôi -ed: "surprised".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Nếu một người CẢM THẤY chán, ta dùng tính từ đuôi -ed để mô tả người đó (ví dụ: "I am bored"), còn nếu một sự việc GÂY RA sự chán, ta dùng đuôi -ing (ví dụ: "The film is boring").',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây chính là quy tắc cốt lõi phân biệt hai loại tính từ này.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'A: "How was the trip?" B: "It was _____! I\'ve never seen such beautiful scenery."',
      options: [
        { id: 'a', text: 'amazing' },
        { id: 'b', text: 'amazed' },
        { id: 'c', text: 'amaze' },
        { id: 'd', text: 'amazes' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"The trip" (sự việc) là chủ ngữ, gây ra cảm giác kinh ngạc: "amazing".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence uses the adjective correctly?',
      options: [
        { id: 'a', text: 'I am confusing about the instructions.' },
        { id: 'b', text: 'I am confused about the instructions.' },
        { id: 'c', text: 'The instructions are confused.' },
        { id: 'd', text: 'The instructions confused me is unclear.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"I" là người cảm thấy bối rối nên dùng "confused" (-ed). "The instructions" (sự việc gây bối rối) mới dùng "confusing", nên câu (c) sai.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 8. Ngữ pháp cơ bản — Bài 8: Trạng Từ
// ---------------------------------------------------------------------------
const adverbs: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 8: Trạng Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The team responded _____ to the crisis.',
      options: [
        { id: 'a', text: 'quick' },
        { id: 'b', text: 'quickly' },
        { id: 'c', text: 'quickness' },
        { id: 'd', text: 'quicker' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Bổ nghĩa cho động từ "responded" cần trạng từ: "responded quickly".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I _____ eat fast food.',
      options: [
        { id: 'a', text: 'never' },
        { id: 'b', text: 'nevery' },
        { id: 'c', text: 'not never' },
        { id: 'd', text: 'never not' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"never" là trạng từ tần suất đúng, đứng trước động từ chính "eat".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He is _____ tall for his age.',
      options: [
        { id: 'a', text: 'very' },
        { id: 'b', text: 'verily' },
        { id: 'c', text: 'much' },
        { id: 'd', text: 'more' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"very" là trạng từ chỉ mức độ, đứng trước tính từ "tall". "verily" không phải từ tiếng Anh hiện đại phù hợp ở đây.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Đổi tính từ "careful" thành trạng từ: "Please drive _____."',
      correctAnswer: { accepted: ['carefully'] },
      explanation: 'careful → carefully (thêm -ly).',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'She sings beautiful.' },
        { id: 'b', text: 'She sings beautifully.' },
        { id: 'c', text: 'She beautiful sings.' },
        { id: 'd', text: 'She sings beautifully well.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Bổ nghĩa cho động từ "sings" cần trạng từ "beautifully", đứng sau động từ.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with the CORRECT irregular adverb.',
      options: [
        { id: 'a', text: 'He works good.' },
        { id: 'b', text: 'He works well.' },
        { id: 'c', text: 'He works goodly.' },
        { id: 'd', text: 'He works welly.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"good" là tính từ bất quy tắc: trạng từ tương ứng là "well" (không phải "goodly").',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp đúng vị trí trạng từ tần suất:',
      options: [
        { id: 'f1', text: 'She' },
        { id: 'f2', text: 'usually' },
        { id: 'f3', text: 'arrives' },
        { id: 'f4', text: 'early' },
      ],
      correctAnswer: { orderedOptionIds: ['f1', 'f2', 'f3', 'f4'] },
      explanation: 'Trạng từ tần suất "usually" đứng trước động từ chính "arrives".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'A: "How does he drive?" B: "He drives _____ — I never worry when he\'s behind the wheel."',
      options: [
        { id: 'a', text: 'careful' },
        { id: 'b', text: 'carefully' },
        { id: 'c', text: 'care' },
        { id: 'd', text: 'carefulness' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Bổ nghĩa cho động từ "drives" cần trạng từ: "drives carefully".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 9. Ngữ pháp cơ bản — Bài 9: Mạo Từ A, An, The
// ---------------------------------------------------------------------------
const articles: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 9: Mạo Từ A, An, The',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He is _____ teacher.',
      options: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'an' },
        { id: 'c', text: 'the' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"teacher" bắt đầu bằng phụ âm, số ít, chưa xác định cụ thể: "a teacher".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I need _____ hour to finish this.',
      options: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'an' },
        { id: 'c', text: 'the' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"hour" có chữ "h" câm nên đọc bắt đầu bằng âm nguyên âm /aʊ/ — vẫn dùng "an" dù chữ viết bắt đầu bằng phụ âm, đúng như ví dụ "an hour" trong bài học.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ Earth is the planet we live on.',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'An' },
        { id: 'c', text: 'The' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"Earth" là vật thể duy nhất, giống "the sun", nên dùng "The".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'I like _____ music.',
      options: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'an' },
        { id: 'c', text: 'the' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'd' },
      explanation:
        '"music" ở đây mang nghĩa chung chung (âm nhạc nói chung), nên KHÔNG dùng mạo từ, giống ví dụ "I like music" trong bài học.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'I saw a sun yesterday.' },
        { id: 'b', text: 'I saw the sun yesterday.' },
        { id: 'c', text: 'I saw an sun yesterday.' },
        { id: 'd', text: 'I saw sun yesterday.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"sun" là vật thể duy nhất nên luôn dùng "the sun".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Điền mạo từ đúng: "She bought _____ apple this morning."',
      correctAnswer: { accepted: ['an'] },
      explanation: '"apple" bắt đầu bằng nguyên âm nên dùng "an".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'A: "Where\'s my pen?" B: "It\'s on _____ table next to the window."',
      options: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'an' },
        { id: 'c', text: 'the' },
        { id: 'd', text: '(không dùng mạo từ)' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Cái bàn được xác định cụ thể trong ngữ cảnh (bàn ở cạnh cửa sổ), nên dùng "the".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence that correctly uses NO article.',
      options: [
        { id: 'a', text: 'I like the music.' },
        { id: 'b', text: 'I like a music.' },
        { id: 'c', text: 'I like music.' },
        { id: 'd', text: 'I like an music.' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"music" chung chung, không đếm được, không xác định cụ thể — không dùng mạo từ nào.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 11. Ngữ pháp cơ bản — Bài 11: Danh Động Từ To V và V ing
// ---------------------------------------------------------------------------
const gerundInfinitive: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 11: Danh Động Từ To V và V ing',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'They hope _____ abroad next year.',
      options: [
        { id: 'a', text: 'traveling' },
        { id: 'b', text: 'to travel' },
        { id: 'c', text: 'travel' },
        { id: 'd', text: 'traveled' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"hope" theo sau bởi Infinitive: "hope to travel".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: "I'm interested in _____ new languages.",
      options: [
        { id: 'a', text: 'learn' },
        { id: 'b', text: 'to learn' },
        { id: 'c', text: 'learning' },
        { id: 'd', text: 'learned' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Sau giới từ "in" luôn dùng Gerund: "interested in learning".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'It is easy _____ this lesson.',
      options: [
        { id: 'a', text: 'understand' },
        { id: 'b', text: 'to understand' },
        { id: 'c', text: 'understanding' },
        { id: 'd', text: 'understood' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Sau tính từ ("easy") dùng Infinitive: "easy to understand".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'He stopped his work for a moment _____ a cigarette. (dừng việc khác LẠI ĐỂ hút thuốc)',
      options: [
        { id: 'a', text: 'smoking' },
        { id: 'b', text: 'to smoke' },
        { id: 'c', text: 'smoke' },
        { id: 'd', text: 'smoked' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"stop to smoke" = dừng lại (việc đang làm) ĐỂ hút thuốc — "to smoke" ở đây chỉ mục đích của việc dừng lại.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He stopped _____ cigarettes completely last year. (từ bỏ hẳn việc hút thuốc)',
      options: [
        { id: 'a', text: 'smoking' },
        { id: 'b', text: 'to smoke' },
        { id: 'c', text: 'smoke' },
        { id: 'd', text: 'smoked' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"stop smoking" = dừng/từ bỏ HÀNH ĐỘNG hút thuốc — khác nghĩa với "stop to smoke" ở câu trước.',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành: "She finished _____ (write) her report before lunch."',
      correctAnswer: { accepted: ['writing'] },
      explanation: '"finish" theo sau bởi Gerund: "finished writing".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Câu nào dưới đây đúng ngữ pháp?',
      options: [
        { id: 'a', text: 'He decided going home.' },
        { id: 'b', text: 'He decided to go home.' },
        { id: 'c', text: 'He decide to go home.' },
        { id: 'd', text: 'He decided go home.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"decide" luôn theo sau bởi Infinitive: "decided to go".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with NO mistake.',
      options: [
        { id: 'a', text: 'She suggested to meet earlier.' },
        { id: 'b', text: 'She suggested meeting earlier.' },
        { id: 'c', text: 'She suggested meet earlier.' },
        { id: 'd', text: 'She suggested to meeting earlier.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"suggest" luôn theo sau bởi Gerund: "suggested meeting".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 12. Ngữ pháp cơ bản — Bài 12: Lượng Từ
// ---------------------------------------------------------------------------
const quantifiers: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 12: Lượng Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: "There isn't _____ sugar left in the jar.",
      options: [
        { id: 'a', text: 'many' },
        { id: 'b', text: 'much' },
        { id: 'c', text: 'few' },
        { id: 'd', text: 'a few' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"sugar" không đếm được nên dùng "much" trong câu phủ định.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He asked _____ questions during the meeting.',
      options: [
        { id: 'a', text: 'much' },
        { id: 'b', text: 'many' },
        { id: 'c', text: 'little' },
        { id: 'd', text: 'a little' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"questions" đếm được số nhiều nên dùng "many".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Would you like _____ coffee?',
      options: [
        { id: 'a', text: 'any' },
        { id: 'b', text: 'some' },
        { id: 'c', text: 'many' },
        { id: 'd', text: 'few' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Trong câu mời/đề nghị (offer), tiếng Anh thường dùng "some" thay vì "any" dù là câu hỏi.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: "I don't have _____ time to explain everything now.",
      options: [
        { id: 'a', text: 'many' },
        { id: 'b', text: 'much' },
        { id: 'c', text: 'few' },
        { id: 'd', text: 'a few' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"time" không đếm được nên dùng "much" trong câu phủ định.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'She has _____ experience, so she can handle this project alone. (có đủ kinh nghiệm)',
      options: [
        { id: 'a', text: 'few' },
        { id: 'b', text: 'a few' },
        { id: 'c', text: 'little' },
        { id: 'd', text: 'a little' },
      ],
      correctAnswer: { optionId: 'd' },
      explanation:
        '"a little" (một chút, đủ dùng) phù hợp với ý nghĩa tích cực "can handle alone". "experience" không đếm được nên không dùng "a few".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'He has _____ experience, so he needs more training. (gần như không có kinh nghiệm)',
      options: [
        { id: 'a', text: 'few' },
        { id: 'b', text: 'a few' },
        { id: 'c', text: 'little' },
        { id: 'd', text: 'a little' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"little" (rất ít, gần như không) phù hợp với ý nghĩa tiêu cực "needs more training".',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền lượng từ đúng cho danh từ đếm được, nghĩa "rất ít, gần như không": "There are _____ apples left — we should buy more."',
      correctAnswer: { accepted: ['few'] },
      explanation: '"apples" đếm được, và ý nghĩa là "gần như không còn" nên dùng "few".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the correct sentence.',
      options: [
        { id: 'a', text: 'She has a lot of patience.' },
        { id: 'b', text: 'She has a lot of patiences.' },
        { id: 'c', text: 'She have a lot of patience.' },
        { id: 'd', text: 'She has lots patience.' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"a lot of" dùng được cho cả danh từ đếm được và không đếm được. "patience" không đếm được nên không có "-s". "lots" cần "of" theo sau ("lots of"), không dùng một mình.',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 13. Ngữ pháp cơ bản — Bài 13: Thì Hiện Tại Đơn
// ---------------------------------------------------------------------------
const presentSimpleTense: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 13: Thì Hiện Tại Đơn',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The store _____ at 9 AM every day.',
      options: [
        { id: 'a', text: 'open' },
        { id: 'b', text: 'opens' },
        { id: 'c', text: 'opening' },
        { id: 'd', text: 'opened' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"The store" là ngôi thứ ba số ít nên động từ thêm -s: "opens".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'We _____ usually have lunch together.',
      options: [
        { id: 'a', text: "don't" },
        { id: 'b', text: "doesn't" },
        { id: 'c', text: "isn't" },
        { id: 'd', text: "aren't" },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"We" dùng trợ động từ "don\'t" cho phủ định động từ thường.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: "She don't like tea." },
        { id: 'b', text: "She doesn't like tea." },
        { id: 'c', text: "She doesn't likes tea." },
        { id: 'd', text: 'She not like tea.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"She" dùng "doesn\'t", và động từ chính sau đó về nguyên thể "like".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Diễn tả một sự thật hiển nhiên: "Water _____ (boil) at 100 degrees Celsius."',
      correctAnswer: { accepted: ['boils'] },
      explanation:
        'Sự thật khoa học hiển nhiên dùng thì hiện tại đơn; "water" (số ít) nên động từ thêm -s: "boils".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'A: "How often _____ you exercise?" B: "I _____ exercise every morning."',
      options: [
        { id: 'a', text: 'Do / always' },
        { id: 'b', text: 'Does / always' },
        { id: 'c', text: 'Do / usually' },
        { id: 'd', text: 'Does / usually' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"you" dùng "Do"; trạng từ tần suất "always" đứng trước động từ chính "exercise".',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Thì hiện tại đơn có thể dùng để diễn tả lịch trình cố định, ví dụ: "The train leaves at 6 PM."',
      correctAnswer: { value: true },
      explanation: 'Đúng, hiện tại đơn diễn tả cả thói quen, sự thật, và lịch trình cố định.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu đúng với trạng từ tần suất:',
      options: [
        { id: 'g1', text: 'My father' },
        { id: 'g2', text: 'always' },
        { id: 'g3', text: 'reads' },
        { id: 'g4', text: 'the newspaper' },
      ],
      correctAnswer: { orderedOptionIds: ['g1', 'g2', 'g3', 'g4'] },
      explanation: 'Trạng từ tần suất "always" đứng trước động từ chính "reads".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with NO mistake.',
      options: [
        { id: 'a', text: 'Does she works every weekend?' },
        { id: 'b', text: 'Does she work every weekend?' },
        { id: 'c', text: 'Do she works every weekend?' },
        { id: 'd', text: 'Is she work every weekend?' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"she" cần "Does", và sau "Does" động từ chính phải về nguyên thể "work".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 14. Ngữ pháp cơ bản — Bài 14: Thì Quá Khứ Đơn
// ---------------------------------------------------------------------------
const pastSimpleTense: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 14: Thì Quá Khứ Đơn',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He _____ a new car last month.',
      options: [
        { id: 'a', text: 'buy' },
        { id: 'b', text: 'buys' },
        { id: 'c', text: 'bought' },
        { id: 'd', text: 'buyed' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"buy" là động từ bất quy tắc: quá khứ đơn là "bought", không phải "buyed".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'We _____ finish the project on time.',
      options: [
        { id: 'a', text: "don't" },
        { id: 'b', text: "doesn't" },
        { id: 'c', text: "didn't" },
        { id: 'd', text: "isn't" },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Phủ định thì quá khứ đơn dùng "didn\'t" cho mọi chủ ngữ.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'He buyed a new car.' },
        { id: 'b', text: 'He bought a new car.' },
        { id: 'c', text: 'He buy a new car yesterday.' },
        { id: 'd', text: 'He boughted a new car.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"buy" bất quy tắc: dạng quá khứ đúng duy nhất là "bought".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Chia đúng động từ "study" ở quá khứ đơn (đổi y → ied): "She _____ hard for the exam last night."',
      correctAnswer: { accepted: ['studied'] },
      explanation: 'Động từ tận cùng phụ âm + y: đổi y thành i rồi thêm -ed: study → studied.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'A: "_____ you sleep well last night?" B: "No, I _____ sleep at all."',
      options: [
        { id: 'a', text: "Did / didn't" },
        { id: 'b', text: "Do / don't" },
        { id: 'c', text: "Were / wasn't" },
        { id: 'd', text: "Did / don't" },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Cả câu hỏi và câu trả lời đều nói về QUÁ KHỨ ("last night"), nên dùng "Did" và "didn\'t" nhất quán.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        '"Go" là động từ bất quy tắc: dạng quá khứ đơn của nó là "went", không phải "goed".',
      correctAnswer: { value: true },
      explanation: 'Đúng, "go" thuộc nhóm động từ bất quy tắc.',
      difficulty: 'EASY',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu đúng:',
      options: [
        { id: 'm1', text: 'The manager' },
        { id: 'm2', text: 'approved' },
        { id: 'm3', text: 'the budget' },
        { id: 'm4', text: 'last Friday' },
      ],
      correctAnswer: { orderedOptionIds: ['m1', 'm2', 'm3', 'm4'] },
      explanation: 'S + V-ed (approved) + O (the budget) + trạng ngữ thời gian ở cuối câu.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with NO mistake.',
      options: [
        { id: 'a', text: 'Did she finished the report?' },
        { id: 'b', text: 'Did she finish the report?' },
        { id: 'c', text: 'Did she finishes the report?' },
        { id: 'd', text: 'Does she finished the report?' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Sau "Did", động từ chính phải về nguyên thể "finish".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 15. Ngữ pháp cơ bản — Bài 15: Thì Hiện Tại Tiếp Diễn
// ---------------------------------------------------------------------------
const presentContinuousTense: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 15: Thì Hiện Tại Tiếp Diễn',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Look! The children _____ in the yard.',
      options: [
        { id: 'a', text: 'play' },
        { id: 'b', text: 'plays' },
        { id: 'c', text: 'are playing' },
        { id: 'd', text: 'played' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"Look!" báo hiệu hành động đang xảy ra ngay lúc nói: "are playing".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He _____ a shower right now.',
      options: [
        { id: 'a', text: 'take' },
        { id: 'b', text: 'takes' },
        { id: 'c', text: 'is taking' },
        { id: 'd', text: 'took' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"right now" là dấu hiệu hiện tại tiếp diễn: "is taking".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'She is play football.' },
        { id: 'b', text: 'She is playing football.' },
        { id: 'c', text: 'She playing football.' },
        { id: 'd', text: 'She plays now football.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Hiện tại tiếp diễn cần đủ "be + V-ing": "is playing".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành: "We _____ (work) on a new project at the moment."',
      correctAnswer: { accepted: ['are working'] },
      explanation: '"at the moment" là dấu hiệu hiện tại tiếp diễn, chủ ngữ "We" chia "are working".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'I am understanding the lesson now.' },
        { id: 'b', text: 'I understand the lesson now.' },
        { id: 'c', text: 'I am understand the lesson now.' },
        { id: 'd', text: 'I understanding the lesson now.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"understand" là động từ chỉ trạng thái, không chia thì tiếp diễn dù có "now" — vẫn dùng hiện tại đơn.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Có thể nói "I am liking this song" để diễn tả sở thích ngay lúc nói.',
      correctAnswer: { value: false },
      explanation:
        'Sai. "like" là động từ chỉ trạng thái (cảm xúc), không chia thì tiếp diễn — phải nói "I like this song."',
      difficulty: 'HARD',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu phủ định đúng:',
      options: [
        { id: 'n1', text: 'They' },
        { id: 'n2', text: 'are' },
        { id: 'n3', text: 'not' },
        { id: 'n4', text: 'working today' },
      ],
      correctAnswer: { orderedOptionIds: ['n1', 'n2', 'n3', 'n4'] },
      explanation: 'S + am/is/are + not + V-ing: "They are not working today."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'A: "What _____ you _____ right now?" B: "I\'m cooking dinner."',
      options: [
        { id: 'a', text: 'do / do' },
        { id: 'b', text: 'are / doing' },
        { id: 'c', text: 'do / doing' },
        { id: 'd', text: 'is / doing' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"right now" báo hiệu hiện tại tiếp diễn: "you" chia "are", động từ chính "doing" (V-ing).',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 16. Ngữ pháp cơ bản — Bài 16: Thì Hiện Tại Hoàn Thành
// ---------------------------------------------------------------------------
const presentPerfectTense: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 16: Thì Hiện Tại Hoàn Thành',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She _____ eaten breakfast yet.',
      options: [
        { id: 'a', text: "haven't" },
        { id: 'b', text: "hasn't" },
        { id: 'c', text: "didn't" },
        { id: 'd', text: "doesn't" },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"She" dùng "hasn\'t" trong thì hiện tại hoàn thành.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'We _____ lived in this city since 2015.',
      options: [
        { id: 'a', text: 'live' },
        { id: 'b', text: 'lived' },
        { id: 'c', text: 'have lived' },
        { id: 'd', text: 'has lived' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"since 2015" (mốc thời gian trong quá khứ, kéo dài đến hiện tại) cần hiện tại hoàn thành: "have lived".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'She has eat breakfast.' },
        { id: 'b', text: 'She has eaten breakfast.' },
        { id: 'c', text: 'She have eaten breakfast.' },
        { id: 'd', text: 'She has ate breakfast.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"eat" ở dạng V3 là "eaten"; "She" dùng "has".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành: "He _____ (just / finish) the report."',
      correctAnswer: { accepted: ['has just finished'] },
      explanation: '"just" (vừa mới xảy ra) dùng hiện tại hoàn thành: "has just finished".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Choose the correct sentence for an action that happened at a SPECIFIC time in the past.',
      options: [
        { id: 'a', text: 'I have visited Paris in 2019.' },
        { id: 'b', text: 'I visited Paris in 2019.' },
        { id: 'c', text: 'I have visited Paris since 2019.' },
        { id: 'd', text: 'I visit Paris in 2019.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Một mốc thời gian CỤ THỂ trong quá khứ ("in 2019") dùng thì quá khứ đơn, không dùng hiện tại hoàn thành.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: "A: \"Have you ever tried Vietnamese food?\" B: \"Yes, I _____ it many times.\"",
      options: [
        { id: 'a', text: 'try' },
        { id: 'b', text: 'tried' },
        { id: 'c', text: 'have tried' },
        { id: 'd', text: 'has tried' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Trả lời về kinh nghiệm ("ever") dùng hiện tại hoàn thành: "have tried".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Câu "I lived here since 2015." đúng ngữ pháp.',
      correctAnswer: { value: false },
      explanation:
        'Sai. "since 2015" báo hiệu hành động kéo dài đến hiện tại, nên phải dùng hiện tại hoàn thành: "I have lived here since 2015."',
      difficulty: 'HARD',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu đúng:',
      options: [
        { id: 'p1', text: 'They' },
        { id: 'p2', text: 'have' },
        { id: 'p3', text: 'never' },
        { id: 'p4', text: 'visited Japan' },
      ],
      correctAnswer: { orderedOptionIds: ['p1', 'p2', 'p3', 'p4'] },
      explanation: 'S + have/has + never + V3: "They have never visited Japan."',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 17. Ngữ pháp cơ bản — Bài 17: Thì Quá Khứ Hoàn Thành
// ---------------------------------------------------------------------------
const pastPerfectTense: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 17: Thì Quá Khứ Hoàn Thành',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'By the time we got to the station, the train _____ already.',
      options: [
        { id: 'a', text: 'leave' },
        { id: 'b', text: 'left' },
        { id: 'c', text: 'had left' },
        { id: 'd', text: 'has left' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"the train leaving" xảy ra TRƯỚC "we got to the station" (một mốc quá khứ khác), nên dùng quá khứ hoàn thành.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'He _____ gone to school before the rain started.',
      options: [
        { id: 'a', text: 'have' },
        { id: 'b', text: 'had' },
        { id: 'c', text: 'has' },
        { id: 'd', text: 'was' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Quá khứ hoàn thành dùng "had" cho mọi chủ ngữ.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'He had went to school.' },
        { id: 'b', text: 'He had gone to school.' },
        { id: 'c', text: 'He had go to school.' },
        { id: 'd', text: 'He has gone to school before.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"go" ở V3 là "gone", không phải "went".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành: "She _____ (already / eat) dinner when we called her."',
      correctAnswer: { accepted: ['had already eaten'] },
      explanation: 'Hành động "eat dinner" hoàn tất TRƯỚC "we called her": "had already eaten".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Choose the sentence that correctly shows the FIRST event happened before the second.',
      options: [
        { id: 'a', text: 'She had cooked dinner before the guests arrived.' },
        { id: 'b', text: 'She cooked dinner before the guests had arrived.' },
        { id: 'c', text: 'She has cooked dinner before the guests arrived.' },
        { id: 'd', text: 'She cooked dinner before the guests arrive.' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Hành động xảy ra TRƯỚC ("cooked dinner") dùng quá khứ hoàn thành "had cooked"; hành động sau ("arrived") dùng quá khứ đơn.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Câu "Had you ever visited Hue before 2020?" là câu hỏi đúng ngữ pháp của thì quá khứ hoàn thành.',
      correctAnswer: { value: true },
      explanation: 'Đúng, câu hỏi quá khứ hoàn thành đảo "Had" lên đầu câu.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu đúng:',
      options: [
        { id: 'q1', text: 'They' },
        { id: 'q2', text: 'had' },
        { id: 'q3', text: 'already' },
        { id: 'q4', text: 'left the office' },
      ],
      correctAnswer: { orderedOptionIds: ['q1', 'q2', 'q3', 'q4'] },
      explanation: 'S + had + already + V3: "They had already left the office."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'A: "Why was he so tired?" B: "Because he _____ all night before the exam."',
      options: [
        { id: 'a', text: 'study' },
        { id: 'b', text: 'studied' },
        { id: 'c', text: 'had studied' },
        { id: 'd', text: 'has studied' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Việc học xảy ra TRƯỚC "was so tired" (một trạng thái quá khứ khác), nên dùng "had studied".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 18. Ngữ pháp cơ bản — Bài 18: Câu Bị Động
// ---------------------------------------------------------------------------
const passiveVoice: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 18: Câu Bị Động',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'English _____ in many countries.',
      options: [
        { id: 'a', text: 'speaks' },
        { id: 'b', text: 'is spoken' },
        { id: 'c', text: 'speak' },
        { id: 'd', text: 'was spoken' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Bị động thì hiện tại đơn: "is spoken".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This house _____ in 1990.',
      options: [
        { id: 'a', text: 'builds' },
        { id: 'b', text: 'is built' },
        { id: 'c', text: 'was built' },
        { id: 'd', text: 'build' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"in 1990" (mốc quá khứ) dùng bị động quá khứ đơn: "was built".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'The car is repair by him.' },
        { id: 'b', text: 'The car is repaired by him.' },
        { id: 'c', text: 'The car repairs by him.' },
        { id: 'd', text: 'The car is repairing by him.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Bị động cần "be + V3": "is repaired".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Chuyển sang bị động: "They built a bridge last year." → "A bridge _____ last year."',
      correctAnswer: { accepted: ['was built'] },
      explanation: 'Chủ động thì quá khứ đơn → bị động: "was built".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Active: "The manager is reviewing the contract." Choose the correct passive form.',
      options: [
        { id: 'a', text: 'The contract is reviewed by the manager.' },
        { id: 'b', text: 'The contract is being reviewed by the manager.' },
        { id: 'c', text: 'The contract was reviewed by the manager.' },
        { id: 'd', text: 'The contract has been reviewed by the manager.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Chủ động là thì hiện tại tiếp diễn ("is reviewing"), nên bị động phải giữ đúng thì: "is being reviewed".',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Câu bị động luôn cần động từ "to be" chia đúng thì, theo sau là V3 (quá khứ phân từ).',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là cấu trúc cốt lõi của câu bị động ở mọi thì.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu bị động đúng:',
      options: [
        { id: 'r1', text: 'The reports' },
        { id: 'r2', text: 'are' },
        { id: 'r3', text: 'checked' },
        { id: 'r4', text: 'every month' },
      ],
      correctAnswer: { orderedOptionIds: ['r1', 'r2', 'r3', 'r4'] },
      explanation: 'S (số nhiều) + are + V3 + trạng ngữ: "The reports are checked every month."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with NO mistake.',
      options: [
        { id: 'a', text: 'The email has sent already.' },
        { id: 'b', text: 'The email has been sent already.' },
        { id: 'c', text: 'The email is sent already by.' },
        { id: 'd', text: 'The email have been sent already.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Bị động thì hiện tại hoàn thành: have/has + been + V3.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 19. Ngữ pháp cơ bản — Bài 19: Câu Điều Kiện
// ---------------------------------------------------------------------------
const conditionals: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 19: Câu Điều Kiện',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Unless you study, you _____.',
      options: [
        { id: 'a', text: 'fail' },
        { id: 'b', text: 'will fail' },
        { id: 'c', text: 'failed' },
        { id: 'd', text: 'would fail' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"Unless" = "If not" — vẫn theo cấu trúc điều kiện loại 1: mệnh đề chính dùng "will".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If she _____ harder, she would pass.',
      options: [
        { id: 'a', text: 'study' },
        { id: 'b', text: 'studies' },
        { id: 'c', text: 'studied' },
        { id: 'd', text: 'will study' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: 'Câu điều kiện loại 2: If + quá khứ đơn, S + would + V.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'If I was you, I would help her.' },
        { id: 'b', text: 'If I were you, I would help her.' },
        { id: 'c', text: 'If I am you, I would help her.' },
        { id: 'd', text: 'If I were you, I will help her.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Loại 2 dùng "were" cho mọi chủ ngữ, và mệnh đề chính dùng "would".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Hoàn thành câu điều kiện loại 0 (sự thật hiển nhiên): "If you don\'t water plants, they _____ (die)."',
      correctAnswer: { accepted: ['die'] },
      explanation: 'Loại 0: If + hiện tại đơn, hiện tại đơn (sự thật hiển nhiên).',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Choose the sentence that means the same as "If it rains, we will stay at home."',
      options: [
        { id: 'a', text: 'Should it rain, we will stay at home.' },
        { id: 'b', text: 'Should it rains, we will stay at home.' },
        { id: 'c', text: 'Rain it should, we will stay at home.' },
        { id: 'd', text: 'It should rain, we will stay at home.' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Đảo ngữ câu điều kiện loại 1: "Should + S + V (nguyên thể), ..." thay cho "If + S + V hiện tại đơn".',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        '"Unless you study, you will fail." có nghĩa tương đương với "If you don\'t study, you will fail."',
      correctAnswer: { value: true },
      explanation: 'Đúng, "unless" = "if not".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu điều kiện loại 1 đúng:',
      options: [
        { id: 's1', text: 'If' },
        { id: 's2', text: 'it rains,' },
        { id: 's3', text: 'we' },
        { id: 's4', text: 'will cancel the trip' },
      ],
      correctAnswer: { orderedOptionIds: ['s1', 's2', 's3', 's4'] },
      explanation: 'If + hiện tại đơn, S + will + V: "If it rains, we will cancel the trip."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with the correct tense for Third Conditional.',
      options: [
        { id: 'a', text: 'If she studied harder, she would have passed.' },
        { id: 'b', text: 'If she had studied harder, she would have passed.' },
        { id: 'c', text: 'If she had studied harder, she would pass.' },
        { id: 'd', text: 'If she has studied harder, she would have passed.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Loại 3: If + S + had + V3, S + would have + V3 — cả hai vế đều phải đúng dạng.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 20. Ngữ pháp cơ bản — Bài 20: So Sánh Trong Tiếng Anh
// ---------------------------------------------------------------------------
const comparisonTense: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 20: So Sánh Trong Tiếng Anh',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This laptop is _____ than mine.',
      options: [
        { id: 'a', text: 'fast' },
        { id: 'b', text: 'faster' },
        { id: 'c', text: 'fastest' },
        { id: 'd', text: 'more fast' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"fast" là tính từ ngắn: so sánh hơn "faster".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: "It's _____ movie of the year.",
      options: [
        { id: 'a', text: 'good' },
        { id: 'b', text: 'better' },
        { id: 'c', text: 'the best' },
        { id: 'd', text: 'the bestest' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"good" bất quy tắc: so sánh nhất là "the best".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'This is most beautiful picture.' },
        { id: 'b', text: 'This is the most beautiful picture.' },
        { id: 'c', text: 'This is more beautiful picture.' },
        { id: 'd', text: 'This is the more beautiful picture.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'So sánh nhất với tính từ dài cần "the most + adj".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Điền dạng so sánh nhất bất quy tắc của "far": "Of all the planets, Neptune is the _____ from the sun."',
      correctAnswer: { accepted: ['farthest', 'furthest'] },
      explanation: 'far → farther/further → the farthest/the furthest (cả hai dạng đều đúng).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Sales this quarter are _____ than last quarter, but still not as good as we hoped.',
      options: [
        { id: 'a', text: 'good' },
        { id: 'b', text: 'better' },
        { id: 'c', text: 'best' },
        { id: 'd', text: 'more good' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"good" bất quy tắc: so sánh hơn là "better".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Câu "Today is worse than yesterday." sử dụng đúng dạng so sánh hơn bất quy tắc của "bad".',
      correctAnswer: { value: true },
      explanation: 'Đúng, bad → worse → the worst.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu so sánh nhất đúng:',
      options: [
        { id: 't1', text: 'This' },
        { id: 't2', text: 'is the best' },
        { id: 't3', text: 'restaurant' },
        { id: 't4', text: 'in town' },
      ],
      correctAnswer: { orderedOptionIds: ['t1', 't2', 't3', 't4'] },
      explanation: 'S + is the best + N + trạng ngữ nơi chốn.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with NO mistake.',
      options: [
        { id: 'a', text: 'He is more further than her in the race.' },
        { id: 'b', text: 'He is farther than her in the race.' },
        { id: 'c', text: 'He is far than her in the race.' },
        { id: 'd', text: 'He is the farther than her in the race.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"far" bất quy tắc: so sánh hơn là "farther" (không thêm "more", không dùng "the" ở dạng so sánh hơn).',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 21. Ngữ pháp cơ bản — Bài 21: Đại Từ Quan Hệ
// ---------------------------------------------------------------------------
const relativePronouns: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 21: Đại Từ Quan Hệ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The teacher _____ helped me is very kind.',
      options: [
        { id: 'a', text: 'which' },
        { id: 'b', text: 'who' },
        { id: 'c', text: 'whom' },
        { id: 'd', text: 'whose' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"The teacher" chỉ người, làm CHỦ NGỮ của mệnh đề ("who helped me"), nên dùng "who". "whom" chỉ dùng khi đại từ quan hệ làm tân ngữ; "whose" chỉ sở hữu; "which" chỉ vật.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The laptop _____ I bought last week is fast.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whom' },
        { id: 'd', text: 'whose' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"The laptop" chỉ vật nên dùng "which". "who"/"whom" chỉ dùng cho người; "whose" chỉ sở hữu.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'The car who is red is mine.' },
        { id: 'b', text: 'The car which is red is mine.' },
        { id: 'c', text: 'The car whom is red is mine.' },
        { id: 'd', text: 'The car whose is red is mine.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"car" chỉ vật nên dùng "which", không dùng "who" (chỉ người).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is grammatically correct WITHOUT a relative pronoun?',
      options: [
        { id: 'a', text: 'The book I read was good.' },
        { id: 'b', text: 'The book who I read was good.' },
        { id: 'c', text: 'The book is I read good.' },
        { id: 'd', text: 'The book which is I read was good.' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Khi đại từ quan hệ làm tân ngữ, có thể bỏ hẳn: "The book (that/which) I read was good." → "The book I read was good."',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Điền đại từ quan hệ đúng: "This is the company _____ hired me." (công ty — tổ chức)',
      correctAnswer: { accepted: ['which', 'that'] },
      explanation: '"company" chỉ vật/tổ chức nên dùng "which" (hoặc "that").',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        '"That" có thể thay thế cho cả "who" và "which" trong mệnh đề quan hệ xác định (thường dùng trong văn nói).',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là quy tắc đã học trong bài.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu đúng:',
      options: [
        { id: 'u1', text: 'The students' },
        { id: 'u2', text: 'who' },
        { id: 'u3', text: 'study hard' },
        { id: 'u4', text: 'usually succeed' },
      ],
      correctAnswer: { orderedOptionIds: ['u1', 'u2', 'u3', 'u4'] },
      explanation: 'S + who + mệnh đề quan hệ + động từ chính.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence with NO mistake.',
      options: [
        { id: 'a', text: 'The man which called you is my boss.' },
        { id: 'b', text: 'The man who called you is my boss.' },
        { id: 'c', text: 'The man whom called you is my boss.' },
        { id: 'd', text: 'The man whose called you is my boss.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"man" chỉ người, làm chủ ngữ của mệnh đề quan hệ, nên dùng "who".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 22. Ngữ pháp cơ bản — Bài 22: Phân Biệt Will Với Be Going To
// ---------------------------------------------------------------------------
const willVsGoingTo: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 22: Phân Biệt Will Với Be Going To',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'A: "The copier is broken." B: "Oh, I _____ call IT support." (quyết định ngay khi nghe)',
      options: [
        { id: 'a', text: 'will' },
        { id: 'b', text: 'am going to' },
        { id: 'c', text: 'going' },
        { id: 'd', text: 'am go to' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Quyết định vừa nghĩ ra ngay lúc nói dùng "will".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'We _____ launch the new product next month. (đã lên kế hoạch từ trước)',
      options: [
        { id: 'a', text: 'will' },
        { id: 'b', text: 'are going to' },
        { id: 'c', text: 'going to' },
        { id: 'd', text: 'are go to' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Kế hoạch đã có từ trước dùng "be going to".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The sky is getting dark. It _____ storm soon.',
      options: [
        { id: 'a', text: 'will' },
        { id: 'b', text: 'is going to' },
        { id: 'c', text: 'is go to' },
        { id: 'd', text: 'will going to' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Dự đoán dựa trên bằng chứng hiện tại (trời tối dần) dùng "be going to". Không kết hợp "will" và "going to" cùng lúc (lỗi thường gặp).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content: 'Hoàn thành (lời hứa tức thì): "Don\'t worry, I _____ (help) you finish this."',
      correctAnswer: { accepted: ['will help'] },
      explanation: 'Lời hứa tức thì dùng "will": "will help".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'A: "We already booked the venue for the conference." B: "Great, so the event _____ definitely happen in March."',
      options: [
        { id: 'a', text: 'will' },
        { id: 'b', text: 'is going to' },
        { id: 'c', text: 'is go to' },
        { id: 'd', text: 'will going to' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Kế hoạch đã xác nhận từ trước ("already booked") nên dùng "be going to", không dùng "will". "is go to" sai cấu trúc; "will going to" sai vì kết hợp cả hai cách diễn đạt tương lai cùng lúc.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content: 'Trong văn nói, "going to" thường được rút gọn thành "gonna".',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là cách nói thông tục phổ biến.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'She will going to study abroad.' },
        { id: 'b', text: 'She is going to study abroad.' },
        { id: 'c', text: 'She will study abroad if she has plan already.' },
        { id: 'd', text: 'She going to study abroad.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Không kết hợp "will" và "going to" cùng lúc; cần đủ "be going to".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Choose the sentence expressing a PREDICTION BASED ON PRESENT EVIDENCE.',
      options: [
        { id: 'a', text: 'I think it will rain tomorrow.' },
        { id: 'b', text: "Look at those dark clouds — it's going to rain." },
        { id: 'c', text: 'It will rain because I feel it.' },
        { id: 'd', text: 'It rains tomorrow.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"Look at those dark clouds" là bằng chứng hiện tại quan sát được, nên dùng "be going to" cho dự đoán dựa trên bằng chứng.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 23. Ngữ pháp cơ bản — Bài 23: Rút Gọn Mệnh Đề Quan Hệ
// ---------------------------------------------------------------------------
const reducedRelativeClauses: SeedPractice = {
  lessonTitle: 'Ngữ pháp cơ bản - Bài 23: Rút Gọn Mệnh Đề Quan Hệ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Rút gọn đúng của "The woman who is sitting near the window is my colleague." là gì?',
      options: [
        { id: 'a', text: 'The woman sit near the window is my colleague.' },
        { id: 'b', text: 'The woman sitting near the window is my colleague.' },
        { id: 'c', text: 'The woman sat near the window is my colleague.' },
        { id: 'd', text: 'The woman to sit near the window is my colleague.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Mệnh đề chủ động rút gọn thành V-ing: "sitting".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Rút gọn đúng của "The documents which were prepared yesterday are on the desk." là gì?',
      options: [
        { id: 'a', text: 'The documents preparing yesterday are on the desk.' },
        { id: 'b', text: 'The documents prepared yesterday are on the desk.' },
        { id: 'c', text: 'The documents prepare yesterday are on the desk.' },
        { id: 'd', text: 'The documents to prepare yesterday are on the desk.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Mệnh đề bị động rút gọn thành V-ed: "prepared".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence is correct?',
      options: [
        { id: 'a', text: 'The man standing there is my uncle.' },
        { id: 'b', text: 'The man stand there is my uncle.' },
        { id: 'c', text: 'The man stands there is my uncle.' },
        { id: 'd', text: 'The man to stand there is my uncle.' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Mệnh đề chủ động rút gọn đúng dùng V-ing: "standing".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Rút gọn: "The employees who are working overtime will get a bonus." → "The employees _____ overtime will get a bonus."',
      correctAnswer: { accepted: ['working'] },
      explanation: 'Mệnh đề chủ động "who are working" rút gọn thành "working".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Choose the correctly reduced sentence for: "The report which was submitted late was rejected."',
      options: [
        { id: 'a', text: 'The report submitting late was rejected.' },
        { id: 'b', text: 'The report submitted late was rejected.' },
        { id: 'c', text: 'The report submit late was rejected.' },
        { id: 'd', text: 'The report to submit late was rejected.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Mệnh đề bị động ("which was submitted") rút gọn thành V-ed: "submitted".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Choose the correctly reduced sentence for: "The engineer who is designing the bridge is very experienced."',
      options: [
        { id: 'a', text: 'The engineer designing the bridge is very experienced.' },
        { id: 'b', text: 'The engineer designed the bridge is very experienced.' },
        { id: 'c', text: 'The engineer design the bridge is very experienced.' },
        { id: 'd', text: 'The engineer to design the bridge is very experienced.' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Mệnh đề chủ động ("who is designing") rút gọn thành V-ing: "designing".',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'Có thể bỏ đại từ quan hệ khi nó làm tân ngữ trong mệnh đề, ví dụ: "The car she drives is new."',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây là quy tắc đã học.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp câu đã rút gọn đúng:',
      options: [
        { id: 'v1', text: 'The candidates' },
        { id: 'v2', text: 'interviewed' },
        { id: 'v3', text: 'yesterday' },
        { id: 'v4', text: 'were impressive' },
      ],
      correctAnswer: { orderedOptionIds: ['v1', 'v2', 'v3', 'v4'] },
      explanation:
        'Mệnh đề bị động rút gọn "(who were) interviewed yesterday" bổ nghĩa cho "The candidates".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 23. Ngữ pháp TOEIC — Bài 1: Từ loại
//     Source of truth: the lesson's own notes (4 position rules for
//     noun/verb/adjective/adverb, the suffix table, the -ly adjective trap,
//     the applicant/application trap). Business-context sentences, deeper
//     application than the quiz (idiomatic reflexive-style traps, error
//     identification, multi-word ordering).
// ---------------------------------------------------------------------------
const partsOfSpeech: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 1: Từ loại',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "The board carefully reviewed the company's financial _____ before approving the merger.",
      options: [
        { id: 'a', text: 'perform' },
        { id: 'b', text: 'performance' },
        { id: 'c', text: 'performing' },
        { id: 'd', text: 'performed' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Sau tính từ "financial" phải là DANH TỪ → "performance". Cụm sở hữu "the company\'s financial ___" cần một danh từ đóng vai trò tân ngữ của "reviewed".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Customers consistently praised the _____ service at the new branch.',
      options: [
        { id: 'a', text: 'friendly' },
        { id: 'b', text: 'friendliness' },
        { id: 'c', text: 'friend' },
        { id: 'd', text: 'friends' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"friendly" kết thúc bằng "-ly" nhưng KHÔNG phải trạng từ — nó đứng ngay trước danh từ "service" nên phải là TÍNH TỪ. Đây đúng là bẫy đã nêu trong bài học: friendly, costly, likely, timely, orderly đều là tính từ dù có đuôi "-ly".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'All new employees must _____ the compliance training within their first month.',
      options: [
        { id: 'a', text: 'complete' },
        { id: 'b', text: 'completed' },
        { id: 'c', text: 'completion' },
        { id: 'd', text: 'completing' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Sau động từ khuyết thiếu "must" luôn là ĐỘNG TỪ NGUYÊN THỂ không chia → "complete".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Only qualified _____ will be contacted for an interview.',
      options: [
        { id: 'a', text: 'applicants' },
        { id: 'b', text: 'applications' },
        { id: 'c', text: 'applying' },
        { id: 'd', text: 'applied' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Chỗ trống cần danh từ chỉ NGƯỜI được liên hệ phỏng vấn → "applicants" (người nộp đơn), không phải "applications" (đơn xin việc — sự vật). Đây chính là bẫy applicant/application đã nêu trong bài.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The _____ of the new marketing strategy exceeded expectations.',
      options: [
        { id: 'a', text: 'implement' },
        { id: 'b', text: 'implementation' },
        { id: 'c', text: 'implemented' },
        { id: 'd', text: 'implementing' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Sau mạo từ "The" và trước giới từ "of" là vị trí DANH TỪ → "implementation". Cùng mẫu "The + ___ + of" đã học.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: "Every word ending in '-ly' functions as an adverb in a sentence.",
      correctAnswer: { value: false },
      explanation:
        'Sai. Một số từ kết thúc bằng "-ly" là TÍNH TỪ: friendly, costly, likely, timely, orderly. Phải luôn kiểm tra vị trí, không chỉ nhìn đuôi từ.',
      difficulty: 'EASY',
    },
    {
      type: 'FILL_BLANK',
      content:
        "Complete with the correct form of \"significant\": The new software has _____ reduced processing time for all transactions.",
      correctAnswer: { accepted: ['significantly'] },
      explanation:
        'Chỗ trống bổ nghĩa cho động từ "reduced" (giữa trợ động từ "has" và động từ chính) nên phải là TRẠNG TỪ → "significantly".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp thành cụm danh từ đúng trật tự từ loại (mạo từ → trạng từ → tính từ → danh từ):',
      options: [
        { id: 'q1', text: 'an' },
        { id: 'q2', text: 'increasingly' },
        { id: 'q3', text: 'popular' },
        { id: 'q4', text: 'product' },
      ],
      correctAnswer: { orderedOptionIds: ['q1', 'q2', 'q3', 'q4'] },
      explanation:
        '"an increasingly popular product": trạng từ "increasingly" bổ nghĩa cho tính từ "popular", cả cụm bổ nghĩa cho danh từ "product".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a part-of-speech mistake?',
      options: [
        { id: 'a', text: 'The manager reviewed the report thoroughly.' },
        { id: 'b', text: 'The company reported a significant increase in sales.' },
        { id: 'c', text: 'She works efficient to meet the deadline.' },
        { id: 'd', text: 'The proposal was highly beneficial to the team.' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"works efficient" sai vì tính từ "efficient" đang bổ nghĩa cho động từ "works" — vị trí đó cần TRẠNG TỪ → phải là "efficiently". Ba câu còn lại đều dùng đúng từ loại ở đúng vị trí.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 24. Ngữ pháp TOEIC — Bài 2: Đại từ
//     Source of truth: the lesson's thin notes (subject vs object pronouns)
//     extended per its own learningObjectives (possessive + reflexive
//     pronoun traps) — the same broader scope the lesson's pre-existing,
//     already-shipped quiz already tests. See audit notes: notes/objectives
//     mismatch, resolved by treating objectives as authoritative.
// ---------------------------------------------------------------------------
const pronouns: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 2: Đại từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ submitted the quarterly report ahead of schedule.',
      options: [
        { id: 'a', text: 'She' },
        { id: 'b', text: 'Her' },
        { id: 'c', text: 'Hers' },
        { id: 'd', text: 'Herself' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Đầu câu, đứng trước động từ "submitted" là vị trí ĐẠI TỪ CHỦ NGỮ → "She".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The director asked _____ to prepare the presentation.',
      options: [
        { id: 'a', text: 'he' },
        { id: 'b', text: 'him' },
        { id: 'c', text: 'his' },
        { id: 'd', text: 'himself' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Sau động từ "asked" là vị trí ĐẠI TỪ TÂN NGỮ → "him".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: '_____ department exceeded its sales target this quarter.',
      options: [
        { id: 'a', text: 'They' },
        { id: 'b', text: 'Them' },
        { id: 'c', text: 'Their' },
        { id: 'd', text: 'Theirs' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Ngay trước danh từ "department" phải là TÍNH TỪ SỞ HỮU → "Their".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The final decision on the merger is not ours — it is _____.',
      options: [
        { id: 'a', text: 'they' },
        { id: 'b', text: 'them' },
        { id: 'c', text: 'their' },
        { id: 'd', text: 'theirs' },
      ],
      correctAnswer: { optionId: 'd' },
      explanation:
        'Không có danh từ theo sau, cần ĐẠI TỪ SỞ HỮU đứng một mình → "theirs" (= their decision).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The CEO _____ signed the contract to reassure investors.',
      options: [
        { id: 'a', text: 'him' },
        { id: 'b', text: 'his' },
        { id: 'c', text: 'himself' },
        { id: 'd', text: 'he' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Đây là cách dùng ĐẠI TỪ PHẢN THÂN để NHẤN MẠNH (không phải vì chủ ngữ và tân ngữ trùng nhau): "himself" nhấn mạnh rằng chính CEO — chứ không phải ai khác — đã ký hợp đồng.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This information should remain strictly between the manager and _____.',
      options: [
        { id: 'a', text: 'I' },
        { id: 'b', text: 'me' },
        { id: 'c', text: 'my' },
        { id: 'd', text: 'mine' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Sau giới từ "between" phải dùng ĐẠI TỪ TÂN NGỮ → "me". Lỗi "between you and I" rất phổ biến nhưng luôn sai.',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'A possessive pronoun (mine, yours, his, hers, ours, theirs) can stand alone in a sentence without a noun following it, unlike a possessive adjective.',
      correctAnswer: { value: true },
      explanation:
        'Đúng. Đại từ sở hữu (mine, theirs...) đứng một mình thay cho cả cụm "danh từ sở hữu", còn tính từ sở hữu (my, their...) luôn cần một danh từ theo sau.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Complete with the correct reflexive pronoun: The staff organized the event by _____ without any outside help.',
      correctAnswer: { accepted: ['themselves'] },
      explanation:
        '"by + đại từ phản thân" = tự làm một mình, không cần giúp đỡ → "by themselves".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content:
        'Sắp xếp thành câu đúng, chú ý vị trí của đại từ chủ ngữ và đại từ tân ngữ:',
      options: [
        { id: 'h1', text: 'The manager' },
        { id: 'h2', text: 'handed' },
        { id: 'h3', text: 'her' },
        { id: 'h4', text: 'the documents' },
      ],
      correctAnswer: { orderedOptionIds: ['h1', 'h2', 'h3', 'h4'] },
      explanation:
        '"The manager" (chủ ngữ) + "handed" (động từ) + "her" (tân ngữ gián tiếp — người nhận) + "the documents" (tân ngữ trực tiếp — vật được đưa). → S + V + O1 + O2.',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 25. Ngữ pháp TOEIC — Bài 3: To V1, V-ing, V1
//     Source of truth: the lesson's own notes. Deeper application than the
//     quiz: idiomatic to-V1/V-ing collocations, causative "let", error
//     identification, dual-accepted "help + V1/to V1".
// ---------------------------------------------------------------------------
const toeicGerundInfinitive: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 3: To V1, V-ing, V1',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The board agreed _____ the new proposal at the next meeting.',
      options: [
        { id: 'a', text: 'to review' },
        { id: 'b', text: 'reviewing' },
        { id: 'c', text: 'review' },
        { id: 'd', text: 'reviewed' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"agree" theo sau bởi TO V1 → "agreed to review".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Our clients avoid _____ business over the holidays.',
      options: [
        { id: 'a', text: 'to discuss' },
        { id: 'b', text: 'discussing' },
        { id: 'c', text: 'discuss' },
        { id: 'd', text: 'discussed' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"avoid" theo sau bởi V-ing → "avoid discussing".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The HR department will let employees _____ from home twice a week.',
      options: [
        { id: 'a', text: 'work' },
        { id: 'b', text: 'to work' },
        { id: 'c', text: 'working' },
        { id: 'd', text: 'worked' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"let someone V1" (bare infinitive, không "to") — "let" thuộc nhóm động từ khiến (let, make, help) đã học.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'She finished _____ the quarterly report before the deadline.',
      options: [
        { id: 'a', text: 'to write' },
        { id: 'b', text: 'writing' },
        { id: 'c', text: 'write' },
        { id: 'd', text: 'written' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"finish" theo sau bởi V-ing → "finished writing".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a to-V1 / V-ing mistake?',
      options: [
        { id: 'a', text: 'He promised to call back later.' },
        { id: 'b', text: 'They considered to expand into the Asian market.' },
        { id: 'c', text: 'We plan to launch the product in June.' },
        { id: 'd', text: 'She avoided answering the tricky question.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        '"consider" theo sau bởi V-ing, không phải "to V1" → phải là "considered expanding". Ba câu còn lại đều đúng: promise/plan + to V1, avoid + V-ing.',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Complete: The manager helped the new hire _____ (understand) the onboarding process.',
      correctAnswer: { accepted: ['understand', 'to understand'] },
      explanation:
        '"help someone" có thể theo sau bởi V1 hoặc TO V1 (cả hai đều đúng) → "helped ... understand" hoặc "helped ... to understand".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content: "'Suggest' can be followed directly by a to-infinitive, as in 'suggest to go'.",
      correctAnswer: { value: false },
      explanation:
        'Sai. "suggest" theo sau bởi V-ing ("suggest going") hoặc mệnh đề "that", không bao giờ trực tiếp bởi "to V1".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng:',
      options: [
        { id: 'u1', text: 'She' },
        { id: 'u2', text: 'offered' },
        { id: 'u3', text: 'to help' },
        { id: 'u4', text: 'with the project' },
      ],
      correctAnswer: { orderedOptionIds: ['u1', 'u2', 'u3', 'u4'] },
      explanation: '"offer" theo sau bởi TO V1 → "offered to help", theo sau bởi giới từ "with".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'After months of negotiation, the two companies finally agreed _____ a joint venture.',
      options: [
        { id: 'a', text: 'to form' },
        { id: 'b', text: 'forming' },
        { id: 'c', text: 'form' },
        { id: 'd', text: 'formed' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"agree" theo sau bởi TO V1 → "agreed to form".',
      difficulty: 'EASY',
    },
  ],
};

// ---------------------------------------------------------------------------
// 26. Ngữ pháp TOEIC — Bài 4: Phân Từ
//     Source of truth: the lesson's own notes. Deeper application: emotion-
//     style participle adjectives extended to business contexts, reduced-
//     clause transformation, error identification.
// ---------------------------------------------------------------------------
const participles: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 4: Phân Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The manager, _____ about the delayed shipment, called the supplier immediately.',
      options: [
        { id: 'a', text: 'concerning' },
        { id: 'b', text: 'concerned' },
        { id: 'c', text: 'concern' },
        { id: 'd', text: 'concerns' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Người quản lý CHỊU TÁC ĐỘNG của cảm giác lo lắng (bị làm cho lo lắng) → phân từ quá khứ "concerned".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The team is reviewing the proposal _____ by the marketing department.',
      options: [
        { id: 'a', text: 'submitting' },
        { id: 'b', text: 'submitted' },
        { id: 'c', text: 'submit' },
        { id: 'd', text: 'submits' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Đề xuất CHỊU TÁC ĐỘNG của việc nộp → phân từ quá khứ "submitted".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Anyone _____ questions about the new policy should contact HR.',
      options: [
        { id: 'a', text: 'having' },
        { id: 'b', text: 'had' },
        { id: 'c', text: 'have' },
        { id: 'd', text: 'has' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"Anyone (who has) questions" rút gọn thành phân từ hiện tại "having".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "Which sentence correctly reduces 'The invoice that was sent last week is still unpaid'?",
      options: [
        { id: 'a', text: 'The invoice sending last week is still unpaid.' },
        { id: 'b', text: 'The invoice sent last week is still unpaid.' },
        { id: 'c', text: 'The invoice send last week is still unpaid.' },
        { id: 'd', text: 'The invoice to send last week is still unpaid.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Bỏ "that was", giữ lại phân từ quá khứ "sent" (mệnh đề bị động rút gọn) → "The invoice sent last week...".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a participle mistake?',
      options: [
        { id: 'a', text: 'The updated schedule was sent to all staff.' },
        { id: 'b', text: 'The presenting data confused the audience.' },
        { id: 'c', text: 'The man standing near the door is our client.' },
        { id: 'd', text: 'The damaged equipment was returned.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Dữ liệu ("data") không tự trình bày chính nó — nó CHỊU TÁC ĐỘNG của việc trình bày → phải là phân từ quá khứ "presented", không phải "presenting".',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        "Reduce the clause: 'Employees who are interested in the workshop should register online' → 'Employees _____ in the workshop should register online.'",
      correctAnswer: { accepted: ['interested'] },
      explanation: 'Bỏ "who are", giữ lại phân từ quá khứ "interested".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "In the phrase 'the increasing demand', 'increasing' is a present participle showing that the demand itself is doing the increasing.",
      correctAnswer: { value: true },
      explanation:
        'Đúng. "demand" ở đây được xem như đang chủ động tăng lên → phân từ hiện tại "increasing".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng, chú ý mệnh đề rút gọn bằng phân từ:',
      options: [
        { id: 'w1', text: 'The proposal' },
        { id: 'w2', text: 'reviewed' },
        { id: 'w3', text: 'by the committee' },
        { id: 'w4', text: 'was rejected' },
      ],
      correctAnswer: { orderedOptionIds: ['w1', 'w2', 'w3', 'w4'] },
      explanation:
        '"The proposal (which was) reviewed by the committee" — mệnh đề bị động rút gọn, theo sau là động từ chính "was rejected".',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The company launched a _____ campaign to attract younger customers.',
      options: [
        { id: 'a', text: 'targeting' },
        { id: 'b', text: 'targeted' },
        { id: 'c', text: 'target' },
        { id: 'd', text: 'targets' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Chiến dịch CHỊU TÁC ĐỘNG của việc nhắm mục tiêu (được nhắm vào ai đó) → "targeted".',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 27. Ngữ pháp TOEIC — Bài 5: So Sánh
//     Source of truth: the lesson's own notes. Deeper application: irregular
//     comparatives (bad/worse, few/fewer), double-comparative error
//     identification, business-performance contexts distinct from Foundation
//     Bài 20's own practice set.
// ---------------------------------------------------------------------------
const toeicComparison: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 5: So Sánh',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The marketing team worked _____ than expected to meet the launch deadline.',
      options: [
        { id: 'a', text: 'hard' },
        { id: 'b', text: 'harder' },
        { id: 'c', text: 'hardest' },
        { id: 'd', text: 'more hard' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Tính từ/trạng từ ngắn "hard" + "-er" → "harder" trong so sánh hơn.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This is by far _____ product we have ever released.',
      options: [
        { id: 'a', text: 'the most successful' },
        { id: 'b', text: 'more successful' },
        { id: 'c', text: 'successfuler' },
        { id: 'd', text: 'the more successful' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"by far the most + adj" nhấn mạnh so sánh nhất → "the most successful".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Employee satisfaction this quarter is _____ as it was last quarter.',
      options: [
        { id: 'a', text: 'as high' },
        { id: 'b', text: 'higher' },
        { id: 'c', text: 'highest' },
        { id: 'd', text: 'more high' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Cấu trúc so sánh bằng: "as + adj + as" → "as high as".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The results were _____ than we had anticipated.',
      options: [
        { id: 'a', text: 'worse' },
        { id: 'b', text: 'more bad' },
        { id: 'c', text: 'badder' },
        { id: 'd', text: 'worst' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"bad" là tính từ bất quy tắc: bad → worse → worst.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a comparison mistake?',
      options: [
        { id: 'a', text: 'This branch performs better than the others.' },
        { id: 'b', text: 'She is the most experienced manager in the company.' },
        { id: 'c', text: 'The new system is more faster than the old one.' },
        { id: 'd', text: "Our costs are as low as our competitors'." },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        '"more faster" là lỗi so sánh kép (double comparative) — chỉ cần một hình thức so sánh, hoặc "faster" hoặc "more fast" không bao giờ dùng cả hai cùng lúc.',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Complete: Customer complaints have become _____ (few) since we launched the new support system.',
      correctAnswer: { accepted: ['fewer'] },
      explanation: '"few" (dùng cho danh từ đếm được) có dạng so sánh hơn là "fewer", không phải "more few".',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "'Less' and 'least' are used to express a LOWER degree of a quality — the opposite of 'more' and 'most'.",
      correctAnswer: { value: true },
      explanation: 'Đúng. "less/least" diễn đạt mức độ thấp hơn, ngược lại với "more/most".',
      difficulty: 'EASY',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng theo cấu trúc so sánh bằng phủ định:',
      options: [
        { id: 'x1', text: 'Our earnings' },
        { id: 'x2', text: 'were' },
        { id: 'x3', text: 'not as strong as' },
        { id: 'x4', text: 'projected' },
      ],
      correctAnswer: { orderedOptionIds: ['x1', 'x2', 'x3', 'x4'] },
      explanation: 'S + V + "not as + adj + as" + phạm vi so sánh ("projected" = dự kiến).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Among all three suppliers, Company A offers _____ prices.',
      options: [
        { id: 'a', text: 'the least expensive' },
        { id: 'b', text: 'less expensive' },
        { id: 'c', text: 'expensiver' },
        { id: 'd', text: 'most less expensive' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"least" là so sánh nhất của "less" — dùng khi so sánh từ ba đối tượng trở lên → "the least expensive".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 28. Ngữ pháp TOEIC — Bài 6: Câu Bị Động
//     Source of truth: the lesson's own notes — strictly the 4 passive
//     tense forms it actually teaches (present simple, past simple, present
//     continuous, present perfect). Deeper application: active→passive
//     transformation, by-agent omission judgment, error identification —
//     no untaught tenses (no future/modal/past-perfect passive) introduced.
// ---------------------------------------------------------------------------
const toeicPassiveVoice: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 6: Câu Bị Động',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'All visitors _____ to sign in at the front desk before entering the office.',
      options: [
        { id: 'a', text: 'are required' },
        { id: 'b', text: 'require' },
        { id: 'c', text: 'is required' },
        { id: 'd', text: 'required' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Chủ ngữ số nhiều "All visitors" + bị động thì hiện tại đơn → "are required".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "Active: 'The company sends invoices on the first of every month.' Which is the correct passive form?",
      options: [
        { id: 'a', text: 'Invoices send on the first of every month by the company.' },
        { id: 'b', text: 'Invoices are sent on the first of every month.' },
        { id: 'c', text: 'Invoices was sent on the first of every month.' },
        { id: 'd', text: 'Invoices being sent on the first of every month.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Chuyển chủ động → bị động thì hiện tại đơn: am/is/are + V-ed/3. Tân ngữ "invoices" (số nhiều) trở thành chủ ngữ mới → "Invoices are sent...". Vì tác nhân "the company" không quan trọng, có thể bỏ "by".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: "The client's complaint _____ immediately after it arrived.",
      options: [
        { id: 'a', text: 'was addressed' },
        { id: 'b', text: 'addressed' },
        { id: 'c', text: 'is addressed' },
        { id: 'd', text: 'has addressed' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Bị động thì quá khứ đơn: was/were + V-ed/3 → "was addressed".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The new safety procedures _____ right now, so please use the back entrance.',
      options: [
        { id: 'a', text: 'are being installed' },
        { id: 'b', text: 'installed' },
        { id: 'c', text: 'is installed' },
        { id: 'd', text: 'were installed' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Bị động thì hiện tại tiếp diễn: am/is/are + being + V-ed/3, phù hợp với "right now" (đang xảy ra).',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "Which sentence correctly omits 'by + agent' because the performer is unknown or unimportant?",
      options: [
        { id: 'a', text: 'The window was broken by someone last night.' },
        { id: 'b', text: 'The report was written by the intern.' },
        { id: 'c', text: 'Coffee is grown in many tropical countries.' },
        { id: 'd', text: 'The award was given by the committee.' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Ở câu (c), tác nhân (những người trồng cà phê) không quan trọng/không xác định nên bị lược bỏ hoàn toàn — không có "by" nào bị thiếu. Ba câu còn lại đều cần giữ "by + agent" vì tác nhân cụ thể và có ý nghĩa.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a passive voice mistake?',
      options: [
        { id: 'a', text: 'The invoices are checked twice before being sent.' },
        { id: 'b', text: 'The proposal has been approve by the board.' },
        { id: 'c', text: 'The office is cleaned every evening.' },
        { id: 'd', text: 'The samples were tested last week.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Bị động thì hiện tại hoàn thành cần V-ed/3, không phải nguyên mẫu: "has been approve" sai → phải là "has been approved".',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        "Change to passive: 'The IT team has already fixed the server issue.' → 'The server issue _____ (already/fix) by the IT team.'",
      correctAnswer: { accepted: ['has already been fixed'] },
      explanation: 'Bị động thì hiện tại hoàn thành: have/has + been + V-ed/3 → "has already been fixed".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        'In TOEIC Reading, passive voice is common in descriptions of job duties, reports, and company announcements because the action itself matters more than who performs it.',
      correctAnswer: { value: true },
      explanation: 'Đúng, đây chính là mẹo TOEIC đã học về ngữ cảnh xuất hiện của câu bị động.',
      difficulty: 'EASY',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu bị động đúng:',
      options: [
        { id: 'y1', text: 'The documents' },
        { id: 'y2', text: 'were reviewed' },
        { id: 'y3', text: 'by the legal team' },
        { id: 'y4', text: 'yesterday' },
      ],
      correctAnswer: { orderedOptionIds: ['y1', 'y2', 'y3', 'y4'] },
      explanation:
        'S (The documents) + be + V-ed/3 (were reviewed) + by + agent (by the legal team) + trạng từ thời gian (yesterday).',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 29. Ngữ pháp TOEIC — Bài 7: Câu Điều Kiện
//     Source of truth: the lesson's own notes (4 conditional types, unless =
//     if not). Deeper application: business hypotheticals, conditional-type
//     recognition, error identification — no mixed conditionals introduced
//     (not taught by this lesson).
// ---------------------------------------------------------------------------
const toeicConditionals: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 7: Câu Điều Kiện',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If the shipment _____ on time, we will meet the delivery deadline.',
      options: [
        { id: 'a', text: 'arrives' },
        { id: 'b', text: 'arrived' },
        { id: 'c', text: 'will arrive' },
        { id: 'd', text: 'had arrived' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Loại 1: If + hiện tại đơn, S + will + V → "arrives".',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If interest rates _____ next year, borrowing costs would increase.',
      options: [
        { id: 'a', text: 'rose' },
        { id: 'b', text: 'rise' },
        { id: 'c', text: 'will rise' },
        { id: 'd', text: 'had risen' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Loại 2: If + quá khứ đơn, S + would + V — dùng để giả định một khả năng trong tương lai, không phải sự thật đã xảy ra → "rose".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'If the negotiations _____ successful last year, the merger would have gone ahead.',
      options: [
        { id: 'a', text: 'had been' },
        { id: 'b', text: 'were' },
        { id: 'c', text: 'are' },
        { id: 'd', text: 'would be' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Loại 3: If + quá khứ hoàn thành, S + would have + V-ed/3 → "had been".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        "Which conditional type is this? 'If you don't submit the form by 5 PM, it won't be processed until next week.'",
      options: [
        { id: 'a', text: 'Loại 0' },
        { id: 'b', text: 'Loại 1' },
        { id: 'c', text: 'Loại 2' },
        { id: 'd', text: 'Loại 3' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Mệnh đề "if" dùng hiện tại đơn ("don\'t submit") và mệnh đề kết quả dùng "will/won\'t" → Loại 1, diễn tả khả năng có thật.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The order will be canceled _____ payment is received within 48 hours.',
      options: [
        { id: 'a', text: 'unless' },
        { id: 'b', text: 'if' },
        { id: 'c', text: 'until' },
        { id: 'd', text: 'because' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"unless" = "if not" → "unless payment is received" = "if payment is not received".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a conditional mistake?',
      options: [
        { id: 'a', text: 'If we lower our prices, we will attract more customers.' },
        { id: 'b', text: 'If she had prepared better, she would have passed the interview.' },
        { id: 'c', text: 'If the market will improve, we will invest more.' },
        { id: 'd', text: 'Unless the client approves the design, we cannot proceed.' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation:
        'Mệnh đề "if" không bao giờ dùng "will" — phải chia hiện tại đơn: "If the market improves, we will invest more."',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Complete: If the company _____ (invest) more in R&D five years ago, it would have become a market leader by now.',
      correctAnswer: { accepted: ['had invested'] },
      explanation: 'Loại 3: If + quá khứ hoàn thành → "had invested".',
      difficulty: 'HARD',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "'Unless' means the same as 'if not', so 'Unless you pay today, service will be suspended' means the same as 'If you don't pay today, service will be suspended.'",
      correctAnswer: { value: true },
      explanation: 'Đúng. "Unless" = "if not" — đây là quy tắc đã học.',
      difficulty: 'EASY',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu điều kiện đúng:',
      options: [
        { id: 'z1', text: 'If the budget is approved' },
        { id: 'z2', text: 'we' },
        { id: 'z3', text: 'will hire' },
        { id: 'z4', text: 'two more staff' },
      ],
      correctAnswer: { orderedOptionIds: ['z1', 'z2', 'z3', 'z4'] },
      explanation: 'Loại 1: mệnh đề "If" (hiện tại đơn) đứng trước, theo sau là S + will + V + O.',
      difficulty: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// 30. Ngữ pháp TOEIC — Bài 8: Mệnh Đề Quan Hệ
//     Source of truth: the lesson's own notes (who/which/that/whose/where/
//     when, defining vs non-defining). Deeper application: possessive
//     "whose", object-pronoun omission, non-defining comma judgment, error
//     identification.
// ---------------------------------------------------------------------------
const relativeClauses: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 8: Mệnh Đề Quan Hệ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The candidate _____ résumé impressed the panel was offered the position.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whose' },
        { id: 'd', text: 'where' },
      ],
      correctAnswer: { optionId: 'c' },
      explanation: '"whose" chỉ sở hữu — hồ sơ CỦA ứng viên.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content:
        'Which sentence is grammatically correct without using any relative pronoun?',
      options: [
        { id: 'a', text: 'The report I sent yesterday is confidential.' },
        { id: 'b', text: 'The employee works overtime is dedicated.' },
        { id: 'c', text: 'The office is where I work is downtown.' },
        { id: 'd', text: 'Whose desk is near the window is my manager.' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Đại từ quan hệ làm TÂN NGỮ trong mệnh đề xác định có thể lược bỏ: "The report (that/which) I sent yesterday...". Đại từ quan hệ làm CHỦ NGỮ (như trong câu b) thì không bao giờ được lược bỏ.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This is the branch _____ recorded the highest profit this year.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whose' },
        { id: 'd', text: 'where' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"which" thay cho vật/tổ chức ("the branch"), làm chủ ngữ của mệnh đề.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Our CEO, _____ founded the company in 2005, will retire next year.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'that' },
        { id: 'c', text: 'which' },
        { id: 'd', text: 'whom' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        'Mệnh đề không xác định (có dấu phẩy) cần "who" cho người, không bao giờ dùng "that".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The department _____ handles customer complaints is understaffed.',
      options: [
        { id: 'a', text: 'who' },
        { id: 'b', text: 'which' },
        { id: 'c', text: 'whose' },
        { id: 'd', text: 'where' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: '"which" thay cho vật/tổ chức ("the department").',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a relative clause mistake?',
      options: [
        { id: 'a', text: 'The report that I reviewed had several errors.' },
        { id: 'b', text: 'Mr. Tran, that is our new director, starts on Monday.' },
        { id: 'c', text: 'This is the office where we hold client meetings.' },
        { id: 'd', text: 'Since 2020 was the year when the company went fully remote.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation:
        'Mệnh đề không xác định (có dấu phẩy, "Mr. Tran, ___, starts...") không được dùng "that" — phải là "who".',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content: 'Complete: The factory _____ the products are made is located overseas.',
      correctAnswer: { accepted: ['where'] },
      explanation: '"where" chỉ nơi chốn ("the factory").',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "In a defining relative clause, the relative pronoun can sometimes be omitted if it functions as the object of the clause (e.g., 'The email (that) I sent').",
      correctAnswer: { value: true },
      explanation: 'Đúng. Đại từ quan hệ làm tân ngữ trong mệnh đề xác định có thể được lược bỏ.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng, chú ý đại từ quan hệ sở hữu:',
      options: [
        { id: 'v1', text: 'The client' },
        { id: 'v2', text: 'whose account' },
        { id: 'v3', text: 'was overdue' },
        { id: 'v4', text: 'received a reminder' },
      ],
      correctAnswer: { orderedOptionIds: ['v1', 'v2', 'v3', 'v4'] },
      explanation:
        '"The client whose account was overdue" là mệnh đề quan hệ bổ nghĩa cho "The client", theo sau là động từ chính "received a reminder".',
      difficulty: 'HARD',
    },
  ],
};

// ---------------------------------------------------------------------------
// 31. Ngữ pháp TOEIC — Bài 9: Giới Từ
//     Source of truth: the lesson's own notes (time/place/means prepositions,
//     by vs with, fixed collocations). Deeper application: deadline "by",
//     duration "for" vs event "during", the by/with trap, "good at" fixed
//     collocation error identification.
// ---------------------------------------------------------------------------
const prepositions: SeedPractice = {
  lessonTitle: 'Ngữ pháp TOEIC - Bài 9 : Giới Từ',
  passingScorePercent: 70,
  questions: [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The quarterly report must be submitted _____ Friday at the latest.',
      options: [
        { id: 'a', text: 'by' },
        { id: 'b', text: 'until' },
        { id: 'c', text: 'since' },
        { id: 'd', text: 'for' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"by + deadline" = phải hoàn thành trước hoặc đến thời điểm đó — cụm rất phổ biến trong TOEIC ("submit by Friday").',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The negotiation lasted _____ nearly three hours.',
      options: [
        { id: 'a', text: 'for' },
        { id: 'b', text: 'during' },
        { id: 'c', text: 'since' },
        { id: 'd', text: 'at' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"for" dùng cho một KHOẢNG THỜI GIAN → "for nearly three hours".',
      difficulty: 'EASY',
    },
    {
      type: 'ORDERING',
      content: 'Sắp xếp thành câu đúng, chú ý giới từ chỉ một sự kiện cụ thể:',
      options: [
        { id: 'y1', text: 'We' },
        { id: 'y2', text: 'will finalize the budget' },
        { id: 'y3', text: 'during the meeting' },
        { id: 'y4', text: 'tomorrow' },
      ],
      correctAnswer: { orderedOptionIds: ['y1', 'y2', 'y3', 'y4'] },
      explanation:
        '"during" dùng cho một sự kiện cụ thể ("the meeting"), đặt sau cụm động từ + tân ngữ, trước trạng từ thời gian "tomorrow".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The new manager is responsible _____ the entire logistics division.',
      options: [
        { id: 'a', text: 'for' },
        { id: 'b', text: 'with' },
        { id: 'c', text: 'about' },
        { id: 'd', text: 'of' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: 'Cụm cố định "responsible for" đã học.',
      difficulty: 'EASY',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'This report was written _____ the finance team.',
      options: [
        { id: 'a', text: 'by' },
        { id: 'b', text: 'with' },
        { id: 'c', text: 'for' },
        { id: 'd', text: 'about' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation: '"by" chỉ TÁC NHÂN thực hiện hành động trong câu bị động → "written by the finance team".',
      difficulty: 'MEDIUM',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'The presentation was created _____ PowerPoint.',
      options: [
        { id: 'a', text: 'with' },
        { id: 'b', text: 'by' },
        { id: 'c', text: 'for' },
        { id: 'd', text: 'about' },
      ],
      correctAnswer: { optionId: 'a' },
      explanation:
        '"with" chỉ CÔNG CỤ/PHƯƠNG TIỆN được dùng để làm việc gì đó, khác với "by" chỉ tác nhân. "PowerPoint" là công cụ, không phải người thực hiện.',
      difficulty: 'HARD',
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which sentence contains a preposition mistake?',
      options: [
        { id: 'a', text: 'The invoice was sent by the accounting department.' },
        { id: 'b', text: 'She is good in negotiating contracts.' },
        { id: 'c', text: 'The office is located between the bank and the pharmacy.' },
        { id: 'd', text: 'We are meeting on Thursday morning.' },
      ],
      correctAnswer: { optionId: 'b' },
      explanation: 'Cụm cố định là "good AT" (giỏi về việc gì), không phải "good in" → phải là "good at negotiating contracts".',
      difficulty: 'HARD',
    },
    {
      type: 'FILL_BLANK',
      content:
        'Complete with the correct preposition: The warehouse is located _____ the two main highways, making delivery convenient.',
      correctAnswer: { accepted: ['between'] },
      explanation: '"between" dùng khi nói về vị trí ở giữa HAI đối tượng.',
      difficulty: 'MEDIUM',
    },
    {
      type: 'TRUE_FALSE',
      content:
        "'By' is commonly used to indicate the agent who performs an action in a passive sentence, while 'with' usually indicates the tool or instrument used.",
      correctAnswer: { value: true },
      explanation: 'Đúng. Đây là quy tắc phân biệt "by" (tác nhân) và "with" (công cụ) đã học.',
      difficulty: 'EASY',
    },
  ],
};

const SEEDS: SeedPractice[] = [
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

const validateSeeds = (): void => {
  SEEDS.forEach((seed) => {
    if (seed.questions.length < 8 || seed.questions.length > 10) {
      throw new Error(
        `[${seed.lessonTitle}] has ${seed.questions.length} practice questions — target is 8-10.`,
      );
    }
    // Keyed on content + options together, not content alone: a generic MC
    // instruction like "Câu nào dưới đây đúng ngữ pháp?" legitimately repeats
    // across unrelated questions whose real content lives in their options —
    // that is reuse of a prompt template, not a duplicate question. Two
    // questions are only flagged when BOTH the instruction and the option
    // set are identical.
    const normalizedQuestions = new Set<string>();
    seed.questions.forEach((question, index) => {
      const normalizedContent = question.content.trim().toLowerCase().replace(/\s+/g, ' ');
      const normalizedOptions = (question.options ?? [])
        .map((o) => o.text.trim().toLowerCase())
        .sort()
        .join('|');
      const identity = `${normalizedContent}::${normalizedOptions}`;
      if (normalizedQuestions.has(identity)) {
        throw new Error(
          `[${seed.lessonTitle}] question #${index + 1}: duplicate question (same content + options) within this dataset.`,
        );
      }
      normalizedQuestions.add(identity);

      if (question.options) {
        const ids = question.options.map((o) => o.id);
        if (new Set(ids).size !== ids.length) {
          throw new Error(
            `[${seed.lessonTitle}] question #${index + 1}: duplicate option ids`,
          );
        }
        const texts = question.options.map((o) => o.text.trim().toLowerCase());
        if (new Set(texts).size !== texts.length) {
          throw new Error(
            `[${seed.lessonTitle}] question #${index + 1}: duplicate option text`,
          );
        }
        if (question.options.some((o) => !o.text.trim())) {
          throw new Error(
            `[${seed.lessonTitle}] question #${index + 1}: empty option text`,
          );
        }
      }
      if (!question.content.trim()) {
        throw new Error(`[${seed.lessonTitle}] question #${index + 1}: empty content`);
      }
      if (!question.explanation.trim()) {
        throw new Error(`[${seed.lessonTitle}] question #${index + 1}: empty explanation`);
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
  });
};

const seedOne = async (seed: SeedPractice): Promise<void> => {
  const lesson = await prisma.lesson.findFirst({
    where: { title: seed.lessonTitle },
    select: { id: true, title: true },
  });

  if (!lesson) {
    throw new Error(
      `Lesson not found: "${seed.lessonTitle}". Its practice was left untouched.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Reuse the existing PRACTICE task if there is one, so LessonTaskProgress
    // rows (which reference it) survive a re-seed — same idempotency
    // contract as grammar-quizzes.seed.ts's QUIZ handling.
    let task = await tx.lessonTask.findFirst({
      where: { lessonId: lesson.id, type: 'PRACTICE' },
    });

    if (!task) {
      const maxOrderIndex = await tx.lessonTask.aggregate({
        where: { lessonId: lesson.id },
        _max: { orderIndex: true },
      });
      task = await tx.lessonTask.create({
        data: {
          lessonId: lesson.id,
          type: 'PRACTICE',
          title: 'Luyện nâng cao',
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

    // Same reasoning as grammar-quizzes.seed.ts: clear only the in-flight
    // attempt (stale question ids), never touch attemptsCount/score/history.
    await tx.lessonTaskProgress.updateMany({
      where: { taskId: task.id },
      data: { currentAttemptAnswers: Prisma.DbNull, currentAttemptSeed: null },
    });
  });

  console.log(
    `  ✓ ${lesson.title}\n      ${seed.questions.length} practice questions, pass ≥ ${seed.passingScorePercent}%, IMMEDIATE feedback, published`,
  );
};

const main = async (): Promise<void> => {
  console.log('\nSeeding Grammar lesson Advanced Practice...\n');
  validateSeeds();
  for (const seed of SEEDS) {
    await seedOne(seed);
  }
  console.log('\nDone.\n');
};

main()
  .catch((error) => {
    console.error('\nSeed failed — no partial practice set was left behind:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
