-- CreateEnum
CREATE TYPE "LearningGoal" AS ENUM ('FOUNDATION', 'TOEIC_450', 'TOEIC_650', 'TOEIC_800', 'GENERAL_ENGLISH', 'REGULAR_PRACTICE');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "level" "CefrLevel";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "learningGoal" "LearningGoal",
ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "placement_questions" (
    "id" TEXT NOT NULL,
    "section" "CourseType" NOT NULL,
    "type" "QuestionType" NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL,
    "content" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" JSONB NOT NULL,
    "explanation" TEXT,
    "audioUrl" TEXT,
    "imageUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placement_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" "LearningGoal",
    "questionIds" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "grammarScore" INTEGER,
    "vocabularyScore" INTEGER,
    "listeningScore" INTEGER,
    "overallScore" INTEGER,
    "estimatedLevel" "CefrLevel",
    "durationSeconds" INTEGER,

    CONSTRAINT "placement_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_answers" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "submitted" JSONB NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "placement_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmaps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" "LearningGoal" NOT NULL,
    "placementAttemptId" TEXT,
    "estimatedLevel" "CefrLevel",
    "items" JSONB NOT NULL,
    "aiSummary" TEXT,
    "aiSummaryAt" TIMESTAMP(3),
    "aiSummaryModel" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "placement_questions_section_difficulty_isPublished_idx" ON "placement_questions"("section", "difficulty", "isPublished");

-- CreateIndex
CREATE INDEX "placement_attempts_userId_completedAt_idx" ON "placement_attempts"("userId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "placement_answers_attemptId_questionId_key" ON "placement_answers"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "roadmaps_userId_key" ON "roadmaps"("userId");

-- AddForeignKey
ALTER TABLE "placement_attempts" ADD CONSTRAINT "placement_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_answers" ADD CONSTRAINT "placement_answers_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "placement_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: grandfather every account that predates this feature as already
-- onboarded, using its own creation date as the honest historical moment.
-- New rows created after this migration default to NULL (onboardedAt is
-- nullable, no default), so a genuinely new user is unaffected. This single
-- statement is the entire backward-compatibility mechanism for the
-- Personalized Onboarding & Placement Test sprint — no runtime code
-- special-cases "predates this feature" anywhere.
UPDATE "users" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
