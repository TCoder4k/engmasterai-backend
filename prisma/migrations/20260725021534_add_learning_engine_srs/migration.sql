-- CreateEnum
CREATE TYPE "LearningState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING', 'MASTERED');

-- CreateEnum
CREATE TYPE "ReviewRating" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateEnum
CREATE TYPE "PracticeSource" AS ENUM ('FLASHCARD', 'DICTATION', 'REVIEW');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "user_word_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "state" "LearningState" NOT NULL DEFAULT 'NEW',
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstLearnedAt" TIMESTAMP(3),
    "masteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_word_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_review_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "rating" "ReviewRating" NOT NULL,
    "previousState" "LearningState" NOT NULL,
    "newState" "LearningState" NOT NULL,
    "previousIntervalDays" INTEGER NOT NULL,
    "newIntervalDays" INTEGER NOT NULL,
    "previousDueAt" TIMESTAMP(3) NOT NULL,
    "newDueAt" TIMESTAMP(3) NOT NULL,
    "newEaseFactor" DOUBLE PRECISION NOT NULL,
    "newRepetitions" INTEGER NOT NULL,
    "newLapses" INTEGER NOT NULL,
    "resultVersion" INTEGER NOT NULL,
    "practiceMode" "PracticeSource" NOT NULL,
    "sessionId" TEXT,
    "clientReviewId" TEXT NOT NULL,
    "responseTimeMs" INTEGER,
    "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_word_progress_userId_nextReviewAt_idx" ON "user_word_progress"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "user_word_progress_userId_state_idx" ON "user_word_progress"("userId", "state");

-- CreateIndex
CREATE INDEX "user_word_progress_wordId_idx" ON "user_word_progress"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "user_word_progress_userId_wordId_key" ON "user_word_progress"("userId", "wordId");

-- CreateIndex
CREATE INDEX "word_review_logs_userId_reviewedAt_idx" ON "word_review_logs"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "word_review_logs_wordId_idx" ON "word_review_logs"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "word_review_logs_userId_clientReviewId_key" ON "word_review_logs"("userId", "clientReviewId");

-- AddForeignKey
ALTER TABLE "user_word_progress" ADD CONSTRAINT "user_word_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_word_progress" ADD CONSTRAINT "user_word_progress_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_review_logs" ADD CONSTRAINT "word_review_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_review_logs" ADD CONSTRAINT "word_review_logs_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_review_logs" ADD CONSTRAINT "word_review_logs_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "user_word_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
