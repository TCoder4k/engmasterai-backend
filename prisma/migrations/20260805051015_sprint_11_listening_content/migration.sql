-- CreateEnum
CREATE TYPE "ListeningMode" AS ENUM ('DICTATION', 'SHADOWING');

-- CreateEnum
CREATE TYPE "ListeningMediaType" AS ENUM ('VIDEO', 'AUDIO');

-- CreateEnum
CREATE TYPE "ListeningMediaProvider" AS ENUM ('YOUTUBE', 'CLOUDINARY', 'EXTERNAL_URL');

-- CreateTable
CREATE TABLE "listening_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameVi" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listening_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listening_contents" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "level" "CefrLevel" NOT NULL,
    "thumbnailUrl" TEXT,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "mediaType" "ListeningMediaType" NOT NULL,
    "mediaProvider" "ListeningMediaProvider" NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "externalMediaId" TEXT,
    "durationMs" INTEGER,
    "supportedModes" "ListeningMode"[],
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listening_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listening_segments" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "ipa" TEXT,
    "translationVi" TEXT,
    "notes" TEXT,
    "startTimeMs" INTEGER NOT NULL,
    "endTimeMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listening_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listening_contents_categoryId_isPublished_orderIndex_idx" ON "listening_contents"("categoryId", "isPublished", "orderIndex");

-- CreateIndex
CREATE INDEX "listening_contents_isPublished_level_idx" ON "listening_contents"("isPublished", "level");

-- CreateIndex
CREATE INDEX "listening_segments_contentId_idx" ON "listening_segments"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "listening_segments_contentId_orderIndex_key" ON "listening_segments"("contentId", "orderIndex");

-- AddForeignKey
ALTER TABLE "listening_contents" ADD CONSTRAINT "listening_contents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "listening_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_segments" ADD CONSTRAINT "listening_segments_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "listening_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
