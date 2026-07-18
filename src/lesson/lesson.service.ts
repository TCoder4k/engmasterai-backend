import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

const USER_SELECT = {
  id: true,
  courseId: true,
  title: true,
  description: true,
  notes: true,
  videoUrl: true,
  pdfUrl: true,
  audioUrl: true,
  videoDurationMinutes: true,
  estimatedStudyMinutes: true,
  learningObjectives: true,
  orderIndex: true,
  createdAt: true,
  updatedAt: true,
};

const MANAGE_SELECT = {
  ...USER_SELECT,
  isPublished: true,
  _count: {
    select: { tasks: true },
  },
};

@Injectable()
export class LessonService {
  constructor(private readonly prismaService: PrismaService) {}

  async findPublishedByCourse(courseId: string, user: { userId: string }) {
    await this.assertCourseAccessibleToUser(courseId, user);

    const lessons = await this.prismaService.lesson.findMany({
      where: { courseId, isPublished: true },
      orderBy: { orderIndex: 'asc' },
      select: USER_SELECT,
    });

    return { data: lessons };
  }

  async findOnePublished(id: string, user: { userId: string }) {
    const lesson = await this.prismaService.lesson.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        isPublished: true,
        course: { select: { isPublished: true } },
      },
    });

    // Same 404 whether the lesson doesn't exist, is an unpublished draft, or its
    // course is unpublished, so an authenticated caller can't probe for draft ids.
    if (!lesson || !lesson.isPublished || !lesson.course.isPublished) {
      throw new NotFoundException(`Lesson with ID ${id} not found`);
    }

    const { isPublished, course, ...publicLesson } = lesson;
    return publicLesson;
  }

  async findAllByCourseManage(courseId: string) {
    await this.assertCourseExists(courseId);

    const lessons = await this.prismaService.lesson.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      select: MANAGE_SELECT,
    });

    return { data: lessons };
  }

  async create(courseId: string, dto: CreateLessonDto) {
    await this.assertCourseExists(courseId);

    const maxOrderIndex = await this.prismaService.lesson.aggregate({
      where: { courseId },
      _max: { orderIndex: true },
    });
    const orderIndex = (maxOrderIndex._max.orderIndex ?? -1) + 1;

    // Construct the Prisma payload explicitly rather than spreading the DTO —
    // the global ValidationPipe has no whitelist, so extra properties could
    // otherwise reach the database. Lessons always start as unpublished drafts
    // at the end of the course's ordering; neither is settable here.
    return this.prismaService.lesson.create({
      data: {
        courseId,
        title: dto.title,
        description: dto.description,
        notes: dto.notes,
        videoUrl: dto.videoUrl,
        pdfUrl: dto.pdfUrl,
        audioUrl: dto.audioUrl,
        videoDurationMinutes: dto.videoDurationMinutes,
        estimatedStudyMinutes: dto.estimatedStudyMinutes,
        learningObjectives: dto.learningObjectives ?? [],
        orderIndex,
      },
      select: MANAGE_SELECT,
    });
  }

  async update(id: string, dto: UpdateLessonDto) {
    await this.findOneOrThrow(id);

    // Same reasoning as create(): only these fields are ever writable through
    // this endpoint. isPublished/orderIndex/courseId are intentionally excluded.
    return this.prismaService.lesson.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.videoUrl !== undefined && { videoUrl: dto.videoUrl }),
        ...(dto.pdfUrl !== undefined && { pdfUrl: dto.pdfUrl }),
        ...(dto.audioUrl !== undefined && { audioUrl: dto.audioUrl }),
        ...(dto.videoDurationMinutes !== undefined && {
          videoDurationMinutes: dto.videoDurationMinutes,
        }),
        ...(dto.estimatedStudyMinutes !== undefined && {
          estimatedStudyMinutes: dto.estimatedStudyMinutes,
        }),
        ...(dto.learningObjectives !== undefined && {
          learningObjectives: dto.learningObjectives,
        }),
      },
      select: MANAGE_SELECT,
    });
  }

  async publish(id: string) {
    const lesson = await this.findOneOrThrow(id);

    if (!lesson.videoUrl && !lesson.audioUrl) {
      throw new BadRequestException(
        'A lesson needs a video or audio before it can be published.',
      );
    }

    return this.prismaService.lesson.update({
      where: { id },
      data: { isPublished: true },
      select: MANAGE_SELECT,
    });
  }

  async unpublish(id: string) {
    await this.findOneOrThrow(id);

    return this.prismaService.lesson.update({
      where: { id },
      data: { isPublished: false },
      select: MANAGE_SELECT,
    });
  }

  // Returns void: the controller responds 204 No Content.
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const taskCount = await this.prismaService.lessonTask.count({
      where: { lessonId: id },
    });

    if (taskCount > 0) {
      throw new BadRequestException(
        'Cannot delete lesson with existing tasks. Remove or reassign tasks first.',
      );
    }

    try {
      await this.prismaService.lesson.delete({ where: { id } });
    } catch (error) {
      // Backstop for the race between the count check above and this delete.
      if (error.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete lesson with existing tasks. Remove or reassign tasks first.',
        );
      }
      throw error;
    }
  }

  private async findOneOrThrow(id: string) {
    const lesson = await this.prismaService.lesson.findUnique({ where: { id } });
    if (!lesson) {
      throw new NotFoundException(`Lesson with ID ${id} not found`);
    }
    return lesson;
  }

  // Access seam: the single place that decides whether a user may see a
  // course's lessons. Today this only checks the course is published; a
  // future Enrollment/purchase model plugs in here without touching callers.
  private async assertCourseAccessibleToUser(courseId: string, _user: { userId: string }) {
    const course = await this.prismaService.course.findUnique({ where: { id: courseId } });
    if (!course || !course.isPublished) {
      throw new NotFoundException(`Course with ID ${courseId} not found`);
    }
    return course;
  }

  private async assertCourseExists(courseId: string) {
    const course = await this.prismaService.course.findUnique({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException(`Course with ID ${courseId} not found`);
    }
    return course;
  }
}
