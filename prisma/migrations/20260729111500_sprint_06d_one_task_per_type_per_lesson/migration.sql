-- Sprint 06D. One LessonTask of each type per lesson.
--
-- Every task lookup in the engine is findFirst({ where: { lessonId, type,
-- isPublished } }) with no orderBy, so two rows of the same type on one
-- lesson meant the student silently got whichever row Postgres happened to
-- return -- possibly a different one on the next request. Verified
-- duplicate-free on both databases before this was written.

-- CreateIndex
CREATE UNIQUE INDEX "lesson_tasks_lessonId_type_key" ON "lesson_tasks"("lessonId", "type");
