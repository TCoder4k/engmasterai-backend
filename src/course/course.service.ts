import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CourseType } from '@prisma/client';

const PUBLIC_SELECT = {
  id: true,
  title: true,
  type: true,
  description: true,
  thumbnail: true,
  isPublished: true,
  createdAt: true,
};

const MANAGE_SELECT = {
  ...PUBLIC_SELECT,
  _count: {
    select: { lessons: true },
  },
};

const MAX_LIMIT = 100;

@Injectable()
export class CourseService {
  constructor(private readonly prismaService: PrismaService) {}

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
      data: courses,
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

    return course;
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
      },
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, dto: UpdateCourseDto) {
    await this.findOneOrThrow(id);

    // Same reasoning as create(): only these four fields are ever writable
    // through this endpoint. isPublished is intentionally excluded — it can
    // only change via publish()/unpublish().
    return this.prismaService.course.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail }),
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
