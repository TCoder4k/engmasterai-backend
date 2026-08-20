import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

// Speaking Partner — admin exercise list pagination + optional scenario
// filter. Mirrors QueryListeningManageDto exactly (same page/limit
// vocabulary). The app-wide ValidationPipe (main.ts) does not enable
// `transform`, so the controller scopes its own transform-enabled pipe to
// this DTO — the same local fix every other paginated admin list uses.

export class QuerySpeakingManageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsOptional()
  @IsUUID()
  scenarioId?: string;
}
