-- CreateTable
CREATE TABLE "lesson_task_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "accuracyPercent" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "durationSeconds" INTEGER,
    "result" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAttemptId" TEXT NOT NULL,

    CONSTRAINT "lesson_task_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_task_attempts_userId_taskId_submittedAt_idx" ON "lesson_task_attempts"("userId", "taskId", "submittedAt");

-- CreateIndex
CREATE INDEX "lesson_task_attempts_userId_submittedAt_idx" ON "lesson_task_attempts"("userId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_task_attempts_userId_clientAttemptId_key" ON "lesson_task_attempts"("userId", "clientAttemptId");

-- AddForeignKey
ALTER TABLE "lesson_task_attempts" ADD CONSTRAINT "lesson_task_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_task_attempts" ADD CONSTRAINT "lesson_task_attempts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "lesson_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
