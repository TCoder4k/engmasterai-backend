import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class UpdateLessonDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @IsOptional()
  videoUrl?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @IsOptional()
  pdfUrl?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @IsOptional()
  audioUrl?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  videoDurationMinutes?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  estimatedStudyMinutes?: number;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  learningObjectives?: string[];
}
