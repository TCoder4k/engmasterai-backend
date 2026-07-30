import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

// Sprint 08 — the query of GET /progress/courses.
//
// Comma-separated ids rather than repeated `courseIds[]` params: the catalog
// builds this from the page of courses it just rendered, and one short
// parameter keeps the URL readable in a network tab, which matters when the
// question being debugged is "why does this course show the wrong percentage".
export class CourseProgressQueryDto {
  // The app-wide ValidationPipe (main.ts) does not enable `transform`, so the
  // controller scopes its own transform-enabled pipe to this DTO — the same
  // pattern CourseController uses for its pagination query.
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @ArrayNotEmpty()
  // 20, not 50. Every lesson of every course listed here has its `notes`
  // loaded so theory availability can be evaluated (see lesson-status.ts), and
  // that is the one cost in this endpoint that scales with content rather than
  // being constant. Twenty courses is more than any real catalog page shows.
  @ArrayMaxSize(20)
  // Version-agnostic, matching ParseUUIDPipe's default everywhere else in this
  // codebase. Pinning v4 here would be a new convention for no gain.
  @IsUUID(undefined, { each: true })
  courseIds: string[];

  // Opt-in per-lesson statuses. Only the course detail page renders a row per
  // lesson; asking for them everywhere would ship a catalog page every lesson
  // status of all twenty courses it lists.
  @IsOptional()
  @IsIn(['lessons'])
  include?: 'lessons';
}
