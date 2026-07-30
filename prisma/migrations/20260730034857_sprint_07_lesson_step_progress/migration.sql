-- CreateEnum
CREATE TYPE "LessonStepKind" AS ENUM ('VIDEO', 'THEORY');

-- CreateTable
CREATE TABLE "lesson_step_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "step" "LessonStepKind" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "highestPositionSeconds" INTEGER,
    "videoDurationSeconds" INTEGER,

    CONSTRAINT "lesson_step_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_step_progress_userId_completedAt_idx" ON "lesson_step_progress"("userId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_step_progress_userId_lessonId_step_key" ON "lesson_step_progress"("userId", "lessonId", "step");

-- AddForeignKey
ALTER TABLE "lesson_step_progress" ADD CONSTRAINT "lesson_step_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_step_progress" ADD CONSTRAINT "lesson_step_progress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
