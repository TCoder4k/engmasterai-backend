import { NotFoundException } from '@nestjs/common';
import {
  ChatContextResolver,
  formatLessonContext,
  formatVocabWordContext,
  MAX_THEORY_EXCERPT_CHARS,
} from './chat-context.resolver';
import { LessonContextProjection, VocabWordContextProjection } from './chat-context.types';

const buildResolver = (overrides: {
  lessonFindUnique?: jest.Mock;
  lessonFindUniqueOrThrow?: jest.Mock;
  vocabWordFindUnique?: jest.Mock;
}) => {
  const prisma = {
    lesson: {
      // Backs assertLessonVisible's own read.
      findUnique:
        overrides.lessonFindUnique ??
        jest.fn().mockResolvedValue({ isPublished: true, course: { isPublished: true } }),
      findUniqueOrThrow:
        overrides.lessonFindUniqueOrThrow ??
        jest.fn().mockResolvedValue({
          title: 'Present Perfect',
          description: 'Learn when to use the present perfect tense.',
          learningObjectives: ['Recognise the form', 'Use it in a sentence'],
          notes: 'The present perfect is formed with have/has + past participle.',
        }),
    },
    vocabWord: {
      findUnique:
        overrides.vocabWordFindUnique ??
        jest.fn().mockResolvedValue({
          text: 'resign',
          ipa: '/rɪˈzaɪn/',
          meanings: [{ meaning: 'từ chức' }],
          examples: [{ sentence: 'She resigned from her job.' }],
        }),
    },
  };
  const resolver = new ChatContextResolver(prisma as never);
  return { resolver, prisma };
};

describe('ChatContextResolver.resolve', () => {
  it('returns null for GENERAL without touching Prisma', async () => {
    const { resolver, prisma } = buildResolver({});

    await expect(resolver.resolve({ type: 'GENERAL' })).resolves.toBeNull();
    expect(prisma.lesson.findUnique).not.toHaveBeenCalled();
    expect(prisma.vocabWord.findUnique).not.toHaveBeenCalled();
  });

  it('LESSON at the theory stage includes the theory excerpt', async () => {
    const { resolver } = buildResolver({});

    const text = await resolver.resolve({
      type: 'LESSON',
      resourceId: 'lesson-1',
      stage: 'theory',
    });

    expect(text).toContain('Present Perfect');
    expect(text).toContain('Recognise the form; Use it in a sentence');
    expect(text).toContain('formed with have/has + past participle');
  });

  it('LESSON at the video stage also includes the theory excerpt', async () => {
    const { resolver } = buildResolver({});

    const text = await resolver.resolve({ type: 'LESSON', resourceId: 'lesson-1', stage: 'video' });

    expect(text).toContain('formed with have/has + past participle');
  });

  it.each(['quiz', 'traphunter', 'practice', undefined] as const)(
    'LESSON at stage=%s NEVER includes lesson.notes, only title/description/objectives',
    async (stage) => {
      const { resolver } = buildResolver({});

      const text = await resolver.resolve({ type: 'LESSON', resourceId: 'lesson-1', stage });

      expect(text).toContain('Present Perfect');
      expect(text).not.toContain('formed with have/has + past participle');
    },
  );

  it('truncates a long theory excerpt rather than sending the whole thing unbounded', async () => {
    const longNotes = 'a'.repeat(MAX_THEORY_EXCERPT_CHARS + 500);
    const { resolver } = buildResolver({
      lessonFindUniqueOrThrow: jest.fn().mockResolvedValue({
        title: 'Long lesson',
        description: null,
        learningObjectives: [],
        notes: longNotes,
      }),
    });

    const text = await resolver.resolve({ type: 'LESSON', resourceId: 'lesson-1', stage: 'theory' });

    expect(text!.length).toBeLessThan(longNotes.length);
    expect(text).toContain('…');
  });

  it('a missing/unpublished/unpublished-course lesson 404s identically (anti-probing), same as GET /lessons/:id', async () => {
    const { resolver } = buildResolver({
      lessonFindUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(
      resolver.resolve({ type: 'LESSON', resourceId: 'missing-lesson' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('VOCAB_WORD resolves the curated meaning/example', async () => {
    const { resolver } = buildResolver({});

    const text = await resolver.resolve({ type: 'VOCAB_WORD', resourceId: 'word-1' });

    expect(text).toContain('resign');
    expect(text).toContain('/rɪˈzaɪn/');
    expect(text).toContain('từ chức');
    expect(text).toContain('She resigned from her job.');
  });

  it('a missing VocabWord 404s', async () => {
    const { resolver } = buildResolver({ vocabWordFindUnique: jest.fn().mockResolvedValue(null) });

    await expect(
      resolver.resolve({ type: 'VOCAB_WORD', resourceId: 'missing-word' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('formatLessonContext / formatVocabWordContext', () => {
  it('formats a minimal lesson projection (no description, no objectives, no excerpt)', () => {
    const projection: LessonContextProjection = {
      title: 'Bare lesson',
      description: null,
      learningObjectives: [],
    };
    expect(formatLessonContext(projection)).toBe(
      'The student is currently viewing the lesson "Bare lesson".',
    );
  });

  it('formats a minimal vocab projection (no ipa, no meaning, no example)', () => {
    const projection: VocabWordContextProjection = {
      word: 'ephemeral',
      ipa: null,
      viMeaning: null,
      exampleEn: null,
    };
    expect(formatVocabWordContext(projection)).toBe(
      'The student is asking about the English word "ephemeral".',
    );
  });
});

// Compile-time-only test: LessonContextProjection is a CLOSED allowlist
// shape. TypeScript's excess-property check on a fresh object literal
// rejects any key this interface does not declare — so a careless future
// edit adding `correctAnswer`/`questionText`/anything from LessonTask
// fails the BUILD, not a runtime assertion someone could forget to write.
// This is the "type-level check" the approved Phase C plan asked for.
describe('LessonContextProjection type shape (compile-time)', () => {
  it('rejects an excess property at compile time (this test only needs to type-check)', () => {
    const valid: LessonContextProjection = {
      title: 'x',
      description: null,
      learningObjectives: [],
    };
    expect(valid).toBeDefined();

    // @ts-expect-error — LessonContextProjection has no field that could
    // carry a graded answer; adding one here must fail `tsc`/`ts-jest`.
    const leaked: LessonContextProjection = {
      title: 'x',
      description: null,
      learningObjectives: [],
      correctAnswer: 'B',
    };
    expect(leaked).toBeDefined();
  });
});
