-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'ORDERING');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- DropForeignKey
ALTER TABLE "lesson_task_progress" DROP CONSTRAINT "lesson_task_progress_userId_fkey";

-- AlterTable
ALTER TABLE "lesson_task_progress" ADD COLUMN     "attemptStartedAt" TIMESTAMP(3),
ADD COLUMN     "lastAnswers" JSONB,
ADD COLUMN     "lastClientAttemptId" TEXT,
ADD COLUMN     "lastDurationSeconds" INTEGER,
ADD COLUMN     "lastSubmitResult" JSONB;

-- AlterTable
ALTER TABLE "lesson_tasks" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passingScorePercent" INTEGER;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "difficulty" "QuestionDifficulty",
ADD COLUMN     "type" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE';

-- AddForeignKey
ALTER TABLE "lesson_task_progress" ADD CONSTRAINT "lesson_task_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
