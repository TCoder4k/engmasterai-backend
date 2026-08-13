-- CreateEnum
CREATE TYPE "LevelSource" AS ENUM ('BEGINNER_ASSUMED', 'TEST_GRADED');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "suitableGoals" "LearningGoal"[] DEFAULT ARRAY[]::"LearningGoal"[];

-- AlterTable
ALTER TABLE "roadmaps" ADD COLUMN     "aiPlanningModel" TEXT,
ADD COLUMN     "aiPlanningUsedAt" TIMESTAMP(3),
ADD COLUMN     "levelSource" "LevelSource";
