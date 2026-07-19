-- CreateEnum
CREATE TYPE "PartOfSpeech" AS ENUM ('NOUN', 'VERB', 'ADJECTIVE', 'ADVERB', 'PRONOUN', 'PREPOSITION', 'CONJUNCTION', 'INTERJECTION', 'DETERMINER', 'PHRASE', 'IDIOM');

-- CreateEnum
CREATE TYPE "WordSource" AS ENUM ('ADMIN', 'IMPORT', 'AI');

-- CreateTable
CREATE TABLE "vocab_words" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ipa" TEXT,
    "audioUrl" TEXT,
    "imageUrl" TEXT,
    "cefrLevel" "CefrLevel",
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "antonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "collocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wordFamily" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "WordSource" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vocab_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocab_word_meanings" (
    "id" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "partOfSpeech" "PartOfSpeech",
    "meaning" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocab_word_meanings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocab_word_examples" (
    "id" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "translation" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocab_word_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocab_deck_words" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocab_deck_words_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vocab_words_text_idx" ON "vocab_words"("text");

-- CreateIndex
CREATE INDEX "vocab_word_meanings_wordId_idx" ON "vocab_word_meanings"("wordId");

-- CreateIndex
CREATE INDEX "vocab_word_examples_wordId_idx" ON "vocab_word_examples"("wordId");

-- CreateIndex
CREATE INDEX "vocab_deck_words_wordId_idx" ON "vocab_deck_words"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "vocab_deck_words_deckId_wordId_key" ON "vocab_deck_words"("deckId", "wordId");

-- AddForeignKey
ALTER TABLE "vocab_word_meanings" ADD CONSTRAINT "vocab_word_meanings_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocab_word_examples" ADD CONSTRAINT "vocab_word_examples_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocab_deck_words" ADD CONSTRAINT "vocab_deck_words_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "vocab_decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocab_deck_words" ADD CONSTRAINT "vocab_deck_words_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "vocab_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
