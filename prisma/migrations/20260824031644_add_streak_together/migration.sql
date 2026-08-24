-- CreateEnum
CREATE TYPE "StreakInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StreakPairStatus" AS ENUM ('ACTIVE', 'BROKEN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('STREAK_INVITATION_RECEIVED', 'STREAK_INVITATION_ACCEPTED', 'STREAK_MILESTONE', 'STREAK_BROKEN', 'STREAK_PARTNER_ACTIVE');

-- CreateTable
CREATE TABLE "streak_invitations" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "StreakInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "streak_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streak_pairs" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "status" "StreakPairStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastQualifiedDay" TEXT,
    "publicShareId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "streak_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "streak_invitations_inviteeId_status_idx" ON "streak_invitations"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "streak_invitations_inviterId_status_idx" ON "streak_invitations"("inviterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "streak_pairs_publicShareId_key" ON "streak_pairs"("publicShareId");

-- CreateIndex
CREATE INDEX "streak_pairs_userLowId_status_idx" ON "streak_pairs"("userLowId", "status");

-- CreateIndex
CREATE INDEX "streak_pairs_userHighId_status_idx" ON "streak_pairs"("userHighId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "streak_pairs_userLowId_userHighId_key" ON "streak_pairs"("userLowId", "userHighId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "streak_invitations" ADD CONSTRAINT "streak_invitations_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streak_invitations" ADD CONSTRAINT "streak_invitations_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streak_pairs" ADD CONSTRAINT "streak_pairs_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streak_pairs" ADD CONSTRAINT "streak_pairs_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
