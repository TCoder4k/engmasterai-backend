-- CreateTable
CREATE TABLE "speaking_scenarios" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameVi" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "level" "CefrLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "speaking_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaking_exercises" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleVi" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "level" "CefrLevel" NOT NULL,
    "aiRole" TEXT NOT NULL,
    "openingLine" TEXT NOT NULL,
    "conversationGoal" TEXT,
    "targetTurns" INTEGER NOT NULL DEFAULT 5,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "speaking_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaking_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "turnCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "speaking_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "speaking_scenarios_isPublished_orderIndex_idx" ON "speaking_scenarios"("isPublished", "orderIndex");

-- CreateIndex
CREATE INDEX "speaking_exercises_scenarioId_isPublished_orderIndex_idx" ON "speaking_exercises"("scenarioId", "isPublished", "orderIndex");

-- CreateIndex
CREATE INDEX "speaking_exercises_isPublished_level_idx" ON "speaking_exercises"("isPublished", "level");

-- CreateIndex
CREATE INDEX "speaking_attempts_userId_exerciseId_startedAt_idx" ON "speaking_attempts"("userId", "exerciseId", "startedAt");

-- AddForeignKey
ALTER TABLE "speaking_exercises" ADD CONSTRAINT "speaking_exercises_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "speaking_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "speaking_exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
