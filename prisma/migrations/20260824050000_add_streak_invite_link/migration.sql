-- AlterTable
ALTER TABLE "users" ADD COLUMN "streakInviteToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_streakInviteToken_key" ON "users"("streakInviteToken");
