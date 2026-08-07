-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('GEMINI');

-- CreateTable
CREATE TABLE "listening_shadowing_segment_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "bestAccuracyPercent" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listening_shadowing_segment_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listening_shadowing_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "rawTranscript" TEXT NOT NULL,
    "normalizedTranscript" TEXT NOT NULL,
    "transcriptSource" "TranscriptSource" NOT NULL,
    "referenceTextSnapshot" TEXT NOT NULL,
    "accuracyPercent" INTEGER NOT NULL,
    "wordsCorrect" INTEGER NOT NULL,
    "wordsTotal" INTEGER NOT NULL,
    "substitutions" INTEGER NOT NULL,
    "insertions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "passThresholdPercent" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAttemptId" TEXT NOT NULL,

    CONSTRAINT "listening_shadowing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listening_shadowing_segment_progress_userId_contentId_compl_idx" ON "listening_shadowing_segment_progress"("userId", "contentId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "listening_shadowing_segment_progress_userId_segmentId_key" ON "listening_shadowing_segment_progress"("userId", "segmentId");

-- CreateIndex
CREATE INDEX "listening_shadowing_attempts_userId_segmentId_submittedAt_idx" ON "listening_shadowing_attempts"("userId", "segmentId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "listening_shadowing_attempts_userId_clientAttemptId_key" ON "listening_shadowing_attempts"("userId", "clientAttemptId");

-- AddForeignKey
ALTER TABLE "listening_shadowing_segment_progress" ADD CONSTRAINT "listening_shadowing_segment_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_shadowing_segment_progress" ADD CONSTRAINT "listening_shadowing_segment_progress_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "listening_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_shadowing_segment_progress" ADD CONSTRAINT "listening_shadowing_segment_progress_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "listening_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_shadowing_attempts" ADD CONSTRAINT "listening_shadowing_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_shadowing_attempts" ADD CONSTRAINT "listening_shadowing_attempts_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "listening_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_shadowing_attempts" ADD CONSTRAINT "listening_shadowing_attempts_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "listening_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
