-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateTable
CREATE TABLE "vocab_libraries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "thumbnail" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vocab_libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocab_decks" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "cefrLevel" "CefrLevel",
    "orderIndex" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vocab_decks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vocab_decks_libraryId_idx" ON "vocab_decks"("libraryId");

-- AddForeignKey
ALTER TABLE "vocab_decks" ADD CONSTRAINT "vocab_decks_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "vocab_libraries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
