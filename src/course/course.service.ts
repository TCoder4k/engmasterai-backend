import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CourseType } from '@prisma/client';
import { getEstimatedMinutesByCourseId } from '../shared/estimated-minutes';

const PUBLIC_SELECT = {
  id: true,
  title: true,
  type: true,
  description: true,
  thumbnail: true,
  isPublished: true,
  createdAt: true,
  // Personalized Onboarding & Placement Test — nullable until an admin sets
  // it. Public because it's ordinary course metadata, not sensitive.
  level: true,
  // Empty by default ("eligible for every goal"). Public for the same
  // reason `level` is.
  suitableGoals: true,
  // Sprint 05: student-facing surfaces (the Grammar module landing page)
  // need a real lesson count per course. Filtered to published lessons —
  // a student must never be told a course has 12 lessons when 4 of them
  // are drafts they cannot open. Counting here keeps the landing page at
  // one request instead of one lesson fetch per card.
  _count: {
    select: { lessons: { where: { isPublished: true } } },
  },
};

// Unchanged semantics: admins count drafts too. This override must stay
// explicit — MANAGE_SELECT spreads PUBLIC_SELECT, so without it the admin
// course screens would silently start hiding draft lessons from their counts.
const MANAGE_SELECT = {
  ...PUBLIC_SELECT,
  _count: {
    select: { lessons: true },
  },
};

const MAX_LIMIT = 100;

type CourseRow = { id: string };

@Injectable()
export class CourseService {
  constructor(private readonly prismaService: PrismaService) {}

  // Sprint 08 — total study time per course, summed over PUBLISHED lessons.
  //
  // This is the sibling of _count.lessons above and exists for the same
  // reason: without it a card showing "12 bài · 340 phút" had to fetch every
  // lesson of every course to add up estimatedStudyMinutes, which is exactly
  // what GrammarRoadmapPage did — one lessons request per course, on top of one
  // progress request per course. Sprint 08 removed the progress half; this
  // removes the other half, and the roadmap drops from 2N requests to one.
  //
  // It is deliberately NOT part of the course-progress payload. This number is
  // the same for every student, so putting it in a per-user, uncacheable
  // response would be duplicating course metadata into a progress read.
  //
  // Prisma cannot sum a relation inside `select`, so this is one groupBy over
  // the ids already fetched — one extra query, constant in page size, no N+1.
  // The groupBy itself lives in shared/estimated-minutes.ts, shared with
  // PlacementService's roadmap duration estimate — see that file's header for
  // why. This method's job is only the courses[] <-> Map join.
  private async withEstimatedMinutes<T extends CourseRow>(
    courses: T[],
  ): Promise<(T & { totalEstimatedMinutes: number })[]> {
    if (courses.length === 0) return [];

    const minutesByCourse = await getEstimatedMinutesByCourseId(
      this.prismaService,
      courses.map((course) => course.id),
    );

    // 0, not null, when no lesson carries a study time — the client already
    // renders the tile only when the value is above zero, so a course with no
    // authored durations shows nothing rather than "0 phút".
    return courses.map((course) => ({
      ...course,
      totalEstimatedMinutes: minutesByCourse.get(course.id) ?? 0,
    }));
  }

  async findPublished(page?: number, limit?: number, type?: CourseType) {
    const take = Math.min(limit || 10, MAX_LIMIT);
    const skip = page ? (page - 1) * take : 0;
    const where = { isPublished: true, ...(type && { type }) };

    const [courses, total] = await Promise.all([
      this.prismaService.course.findMany({
        where,
        skip,
        take,
        select: PUBLIC_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.course.count({ where }),
    ]);

    return {
      data: await this.withEstimatedMinutes(courses),
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findAllManage(page?: number, limit?: number, type?: CourseType) {
    const take = Math.min(limit || 10, MAX_LIMIT);
    const skip = page ? (page - 1) * take : 0;
    const where = { ...(type && { type }) };

    const [courses, total] = await Promise.all([
      this.prismaService.course.findMany({
        where,
        skip,
        take,
        select: MANAGE_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.course.count({ where }),
    ]);

    return {
      data: courses,
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findOnePublished(id: string) {
    const course = await this.prismaService.course.findUnique({
      where: { id },
      select: PUBLIC_SELECT,
    });

    // Same 404 whether the id doesn't exist or the course is an unpublished draft,
    // so anonymous callers can't probe for draft ids.
    if (!course || !course.isPublished) {
      throw new NotFoundException(`Course with ID ${id} not found`);
    }

    const [withMinutes] = await this.withEstimatedMinutes([course]);
    return withMinutes;
  }

  async create(dto: CreateCourseDto) {
    // Construct the Prisma payload explicitly rather than spreading the DTO —
    // even with class-validator's checks passing, spreading would let any
    // extra property that happens to share a name with a real column (e.g.
    // isPublished, id, createdAt) reach the database. Courses always start
    // as unpublished drafts; there is no way to set isPublished here.
    return this.prismaService.course.create({
      data: {
        title: dto.title,
        type: dto.type,
        description: dto.description,
        thumbnail: dto.thumbnail,
        level: dto.level,
        suitableGoals: dto.suitableGoals ?? [],
      },
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, dto: UpdateCourseDto) {
    await this.findOneOrThrow(id);

    // Same reasoning as create(): only these fields are ever writable
    // through this endpoint. isPublished is intentionally excluded — it can
    // only change via publish()/unpublish().
    return this.prismaService.course.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.suitableGoals !== undefined && {
          suitableGoals: dto.suitableGoals,
        }),
      },
      select: PUBLIC_SELECT,
    });
  }

  async publish(id: string) {
    await this.findOneOrThrow(id);

    return this.prismaService.course.update({
      where: { id },
      data: { isPublished: true },
      select: PUBLIC_SELECT,
    });
  }

  async unpublish(id: string) {
    await this.findOneOrThrow(id);

    return this.prismaService.course.update({
      where: { id },
      data: { isPublished: false },
      select: PUBLIC_SELECT,
    });
  }

  // Returns void: the controller responds 204 No Content, so there is no
  // response body to populate — returning a message here would be dead code.
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);

    const lessonCount = await this.prismaService.lesson.count({
      where: { courseId: id },
    });

    if (lessonCount > 0) {
      throw new BadRequestException(
        'Cannot delete course with existing lessons. Remove or reassign lessons first.',
      );
    }

    try {
      await this.prismaService.course.delete({ where: { id } });
    } catch (error) {
      // Backstop for the race between the count check above and this delete
      // (e.g. a lesson created concurrently) — Postgres FK violation.
      if (error.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete course with existing lessons. Remove or reassign lessons first.',
        );
      }
      throw error;
    }
  }

  private async findOneOrThrow(id: string) {
    const course = await this.prismaService.course.findUnique({
      where: { id },
    });

    if (!course) {
      throw new NotFoundException(`Course with ID ${id} not found`);
    }

    return course;
  }
}
