import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { CourseService } from './course.service';
import { CreateCourseDto, UpdateCourseDto, QueryCourseDto } from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { UserRole } from '@prisma/client';

// The app-wide ValidationPipe (main.ts) doesn't enable `transform`, so query
// string values ("5") wouldn't be coerced to numbers for the DTO's @Type()
// decorators. Scoping a transform-enabled pipe to just these two params
// keeps that behavior local to Course list endpoints instead of changing
// global validation behavior for every other module.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  // Public — lists published courses only.
  @Get()
  async findPublished(@Query(queryPipe) query: QueryCourseDto) {
    return this.courseService.findPublished(
      query.page,
      query.limit,
      query.type,
    );
  }

  // Admin only — lists all courses including drafts.
  // Declared before ':id' so it isn't swallowed by the dynamic route.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('manage')
  async findAllManage(@Query(queryPipe) query: QueryCourseDto) {
    return this.courseService.findAllManage(
      query.page,
      query.limit,
      query.type,
    );
  }

  // Public — single published course.
  @Get(':id')
  async findOnePublished(@Param('id', ParseUUIDPipe) id: string) {
    return this.courseService.findOnePublished(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateCourseDto) {
    return this.courseService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.courseService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/publish')
  async publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.courseService.publish(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/unpublish')
  async unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.courseService.unpublish(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.courseService.remove(id);
  }
}
