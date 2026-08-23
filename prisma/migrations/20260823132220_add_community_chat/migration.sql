-- CreateTable
CREATE TABLE "community_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_messages_createdAt_id_idx" ON "community_messages"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "community_messages_userId_clientMessageId_key" ON "community_messages"("userId", "clientMessageId");

-- AddForeignKey
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
