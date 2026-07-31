-- CreateIndex
CREATE INDEX "lesson_step_progress_userId_lastActivityAt_idx" ON "lesson_step_progress"("userId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "lesson_task_progress_userId_completedAt_idx" ON "lesson_task_progress"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "user_word_progress_userId_createdAt_idx" ON "user_word_progress"("userId", "createdAt");
