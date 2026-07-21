import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LessonService } from './lesson.service';
import { CreateLessonDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { UserRole } from '@prisma/client';

@Controller('courses/:courseId/lessons')
export class LessonCourseController {
  constructor(private readonly lessonService: LessonService) {}

  // Authenticated users — published lessons of an accessible course only.
  @UseGuards(JwtAuthGuard)
  @Get()
  async findPublishedByCourse(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Req() req,
  ) {
    return this.lessonService.findPublishedByCourse(courseId, req.user);
  }

  // Admin only — all lessons for the course, including drafts.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async findAllByCourseManage(
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.lessonService.findAllByCourseManage(courseId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  async create(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateLessonDto,
  ) {
    return this.lessonService.create(courseId, dto);
  }
}
