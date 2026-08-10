-- CreateTable
CREATE TABLE "vocab_guess_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "learnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vocab_guess_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vocab_guess_progress_userId_deckId_idx" ON "vocab_guess_progress"("userId", "deckId");

-- CreateIndex
CREATE UNIQUE INDEX "vocab_guess_progress_userId_deckId_wordId_key" ON "vocab_guess_progress"("userId", "deckId", "wordId");

-- AddForeignKey
ALTER TABLE "vocab_guess_progress" ADD CONSTRAINT "vocab_guess_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocab_guess_progress" ADD CONSTRAINT "vocab_guess_progress_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "vocab_decks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocab_guess_progress" ADD CONSTRAINT "vocab_guess_progress_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
