/*
  Warnings:

  - You are about to drop the column `isFree` on the `lessons` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `lessons` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "lessons" DROP COLUMN "isFree",
ADD COLUMN     "audioUrl" TEXT,
ADD COLUMN     "estimatedStudyMinutes" INTEGER,
ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "learningObjectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pdfUrl" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "videoDurationMinutes" INTEGER,
ADD COLUMN     "videoUrl" TEXT;

-- CreateIndex
CREATE INDEX "lessons_courseId_idx" ON "lessons"("courseId");
