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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { SpeakingRateLimitGuard } from './rate-limit/speaking-rate-limit.guard';
import { SpeakingRateLimit } from './rate-limit/speaking-rate-limits.decorator';
import { SpeakingScenarioService } from './speaking-scenario.service';
import { SpeakingExerciseService } from './speaking-exercise.service';
import {
  CreateSpeakingScenarioDto,
  CreateSpeakingExerciseDto,
  QuerySpeakingManageDto,
  UpdateSpeakingScenarioDto,
  UpdateSpeakingExerciseDto,
} from './dto';

// Speaking Partner authoring, ADMIN only.
//
// Every route carries JwtAuthGuard + RolesGuard + @Roles(ADMIN). The
// frontend also gates /admin/* behind ProtectedRoute role="ADMIN", but that
// is a UX gate: this is the one that matters.
//
// Kind `manage`, matching every other admin surface in this codebase.
const queryPipe = new ValidationPipe({ transform: true });

@Controller('speaking/manage')
@UseGuards(JwtAuthGuard, RolesGuard, SpeakingRateLimitGuard)
@Roles(UserRole.ADMIN)
@SpeakingRateLimit({ kind: 'manage', max: 120, windowSeconds: 60 })
export class SpeakingAdminController {
  constructor(
    private readonly scenarioService: SpeakingScenarioService,
    private readonly exerciseService: SpeakingExerciseService,
  ) {}

  // --- scenarios ---------------------------------------------------------

  @Get('scenarios')
  async findScenarios() {
    return this.scenarioService.findAllManage();
  }

  @Post('scenarios')
  async createScenario(@Body() dto: CreateSpeakingScenarioDto) {
    return this.scenarioService.create(dto);
  }

  @Patch('scenarios/:id')
  async updateScenario(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpeakingScenarioDto,
  ) {
    return this.scenarioService.update(id, dto);
  }

  @Patch('scenarios/:id/publish')
  async publishScenario(@Param('id', ParseUUIDPipe) id: string) {
    return this.scenarioService.publish(id);
  }

  // Takes every exercise in this scenario off the student surface at once —
  // exercises keep their own isPublished, so re-publishing restores the
  // previous state rather than a flattened one.
  @Patch('scenarios/:id/unpublish')
  async unpublishScenario(@Param('id', ParseUUIDPipe) id: string) {
    return this.scenarioService.unpublish(id);
  }

  @Delete('scenarios/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeScenario(@Param('id', ParseUUIDPipe) id: string) {
    return this.scenarioService.remove(id);
  }

  // --- exercises -----------------------------------------------------------

  @Get('exercises')
  async findExercises(@Query(queryPipe) query: QuerySpeakingManageDto) {
    return this.exerciseService.findAllManage(query);
  }

  @Get('exercises/:id')
  async findExercise(@Param('id', ParseUUIDPipe) id: string) {
    return this.exerciseService.findOneManage(id);
  }

  @Post('exercises')
  async createExercise(@Body() dto: CreateSpeakingExerciseDto) {
    return this.exerciseService.create(dto);
  }

  @Patch('exercises/:id')
  async updateExercise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpeakingExerciseDto,
  ) {
    return this.exerciseService.update(id, dto);
  }

  @Patch('exercises/:id/publish')
  async publishExercise(@Param('id', ParseUUIDPipe) id: string) {
    return this.exerciseService.publish(id);
  }

  @Patch('exercises/:id/unpublish')
  async unpublishExercise(@Param('id', ParseUUIDPipe) id: string) {
    return this.exerciseService.unpublish(id);
  }

  @Delete('exercises/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeExercise(@Param('id', ParseUUIDPipe) id: string) {
    return this.exerciseService.remove(id);
  }
}
