-- CreateTable
CREATE TABLE "community_read_states" (
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_read_states_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "community_read_states" ADD CONSTRAINT "community_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
