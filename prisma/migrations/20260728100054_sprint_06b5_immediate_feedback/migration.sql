-- CreateEnum
CREATE TYPE "QuizFeedbackMode" AS ENUM ('IMMEDIATE', 'ON_SUBMIT');

-- AlterTable
ALTER TABLE "lesson_task_progress" ADD COLUMN     "currentAttemptAnswers" JSONB,
ADD COLUMN     "currentAttemptSeed" TEXT;

-- AlterTable
ALTER TABLE "lesson_tasks" ADD COLUMN     "feedbackMode" "QuizFeedbackMode" NOT NULL DEFAULT 'IMMEDIATE';
