import { IsEnum } from 'class-validator';
import { LearningGoal } from '@prisma/client';

// PUT /placement/goal — always allowed, even post-onboarding (see the
// plan's M2 resolution: this is inert with respect to any already-generated
// Roadmap until an explicit start/start-beginner call regenerates one).
export class SetPlacementGoalDto {
  @IsEnum(LearningGoal)
  goal: LearningGoal;
}
