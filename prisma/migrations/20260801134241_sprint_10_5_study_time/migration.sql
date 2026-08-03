-- CreateEnum
CREATE TYPE "StudyActivityType" AS ENUM ('VIDEO', 'THEORY', 'QUIZ', 'PRACTICE', 'TRAP_HUNTER', 'SRS_REVIEW', 'VOCAB_PRACTICE', 'LISTENING');

-- CreateTable
CREATE TABLE "study_time_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityType" "StudyActivityType" NOT NULL,
    "activityId" TEXT,
    "clientSessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "creditedSeconds" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_time_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_time_events_userId_occurredAt_idx" ON "study_time_events"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "study_time_events_userId_clientSessionId_sequence_key" ON "study_time_events"("userId", "clientSessionId", "sequence");

-- AddForeignKey
ALTER TABLE "study_time_events" ADD CONSTRAINT "study_time_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
