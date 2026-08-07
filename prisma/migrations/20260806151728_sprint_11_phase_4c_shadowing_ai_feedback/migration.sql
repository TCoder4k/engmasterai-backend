-- AlterTable
ALTER TABLE "listening_shadowing_attempts" ADD COLUMN     "aiFeedback" TEXT,
ADD COLUMN     "aiFeedbackAt" TIMESTAMP(3),
ADD COLUMN     "aiFeedbackModel" TEXT;
