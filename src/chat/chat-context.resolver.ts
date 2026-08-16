import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertLessonVisible } from '../lesson/quiz/lesson-visibility';
import {
  ChatContextInput,
  LessonContextProjection,
  LessonContextStage,
  VocabWordContextProjection,
} from './chat-context.types';

/**
 * Bounds how much of `Lesson.notes` can enter a single prompt. Input-context
 * truncation, not output truncation (contrast truncateEngyReply) — a hard
 * cut is fine here since this text is never shown to the student directly,
 * only read by the model.
 */
export const MAX_THEORY_EXCERPT_CHARS = 4000;

/**
 * Phase C — builds the plain-text context block handed to
 * GeminiEngyChatProvider alongside the student's message. This is the ONE
 * place that decides which lesson/vocab fields are safe to forward — see
 * chat-context.types.ts's header comment on why the allowlist is enforced
 * by the TYPE shape, not by a list of fields to remember to exclude.
 *
 * Reuses `assertLessonVisible` directly from LessonModule's own
 * lesson-visibility.ts (a dependency-free pure function, same cross-module
 * reuse as `timezone.util.ts` — see docs/CLAUDE.md's Known Technical Debt)
 * rather than re-implementing the same anti-probing 404 policy here.
 */
@Injectable()
export class ChatContextResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(context: ChatContextInput): Promise<string | null> {
    if (context.type === 'GENERAL') return null;
    if (context.type === 'LESSON') {
      return formatLessonContext(await this.resolveLesson(context.resourceId, context.stage));
    }
    return formatVocabWordContext(await this.resolveVocabWord(context.resourceId));
  }

  private async resolveLesson(
    lessonId: string,
    stage: LessonContextStage | undefined,
  ): Promise<LessonContextProjection> {
    // Same anti-probing policy as GET /lessons/:id and the quiz/practice
    // endpoints — a lesson that is missing, unpublished, or in an
    // unpublished course all 404 identically.
    await assertLessonVisible(this.prisma, lessonId);

    const lesson = await this.prisma.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      select: { title: true, description: true, learningObjectives: true, notes: true },
    });

    const projection: LessonContextProjection = {
      title: lesson.title,
      description: lesson.description,
      learningObjectives: lesson.learningObjectives,
    };

    // ONLY video/theory, and ONLY when notes actually exist. Never
    // quiz/traphunter/practice/undefined, regardless of what the client
    // claims — there is no branch here that reads LessonTask/Question for
    // any stage, so this cannot be bypassed by lying about the stage.
    if ((stage === 'video' || stage === 'theory') && lesson.notes) {
      projection.theoryExcerpt = truncateExcerpt(lesson.notes);
    }

    return projection;
  }

  private async resolveVocabWord(vocabWordId: string): Promise<VocabWordContextProjection> {
    const word = await this.prisma.vocabWord.findUnique({
      where: { id: vocabWordId },
      select: {
        text: true,
        ipa: true,
        meanings: { select: { meaning: true }, orderBy: { orderIndex: 'asc' }, take: 1 },
        examples: { select: { sentence: true }, orderBy: { orderIndex: 'asc' }, take: 1 },
      },
    });
    // VocabWord has no draft/published concept to hide — unlike Lesson, a
    // missing id is just a missing id, not something anti-probing-sensitive.
    if (!word) {
      throw new NotFoundException(`VocabWord ${vocabWordId} not found`);
    }

    return {
      word: word.text,
      ipa: word.ipa,
      viMeaning: word.meanings[0]?.meaning ?? null,
      exampleEn: word.examples[0]?.sentence ?? null,
    };
  }
}

/** Exported for tests. Turns the allowlisted projection into the prompt text. */
export const formatLessonContext = (projection: LessonContextProjection): string => {
  const lines = [`The student is currently viewing the lesson "${projection.title}".`];
  if (projection.description) {
    lines.push(`Lesson description: ${projection.description}`);
  }
  if (projection.learningObjectives.length > 0) {
    lines.push(`Learning objectives: ${projection.learningObjectives.join('; ')}`);
  }
  if (projection.theoryExcerpt) {
    lines.push(
      `The theory content the student is currently reading:\n${projection.theoryExcerpt}`,
    );
  }
  return lines.join('\n');
};

/** Exported for tests. */
export const formatVocabWordContext = (projection: VocabWordContextProjection): string => {
  const lines = [`The student is asking about the English word "${projection.word}".`];
  if (projection.ipa) lines.push(`IPA: ${projection.ipa}`);
  if (projection.viMeaning) lines.push(`Curated Vietnamese meaning: ${projection.viMeaning}`);
  if (projection.exampleEn) lines.push(`Example sentence: ${projection.exampleEn}`);
  return lines.join('\n');
};

const truncateExcerpt = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_THEORY_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_THEORY_EXCERPT_CHARS)}…`;
};
