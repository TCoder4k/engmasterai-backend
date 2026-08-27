-- CreateTable
CREATE TABLE "personal_vocab_words" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textNormalized" TEXT NOT NULL,
    "ipa" TEXT,
    "meaningVi" TEXT NOT NULL,
    "meaningEn" TEXT,
    "audioUrl" TEXT,
    "exampleSentence" TEXT,
    "exampleTranslation" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" "LearningState" NOT NULL DEFAULT 'NEW',
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "firstLearnedAt" TIMESTAMP(3),
    "masteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "personal_vocab_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_word_review_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personalWordId" TEXT NOT NULL,
    "rating" "ReviewRating" NOT NULL,
    "clientReviewId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_word_review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_vocab_words_userId_nextReviewAt_idx" ON "personal_vocab_words"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "personal_vocab_words_userId_state_idx" ON "personal_vocab_words"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "personal_vocab_words_userId_textNormalized_key" ON "personal_vocab_words"("userId", "textNormalized");

-- CreateIndex
CREATE INDEX "personal_word_review_logs_userId_reviewedAt_idx" ON "personal_word_review_logs"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "personal_word_review_logs_personalWordId_idx" ON "personal_word_review_logs"("personalWordId");

-- CreateIndex
CREATE UNIQUE INDEX "personal_word_review_logs_userId_clientReviewId_key" ON "personal_word_review_logs"("userId", "clientReviewId");

-- AddForeignKey
ALTER TABLE "personal_vocab_words" ADD CONSTRAINT "personal_vocab_words_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_word_review_logs" ADD CONSTRAINT "personal_word_review_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_word_review_logs" ADD CONSTRAINT "personal_word_review_logs_personalWordId_fkey" FOREIGN KEY ("personalWordId") REFERENCES "personal_vocab_words"("id") ON DELETE CASCADE ON UPDATE CASCADE;
