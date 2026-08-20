-- AlterTable
ALTER TABLE "speaking_scenarios" ADD COLUMN     "suitableGoals" "LearningGoal"[] DEFAULT ARRAY[]::"LearningGoal"[];

-- Backfill: the existing Free Talk scenario becomes eligible for the
-- GENERAL_ENGLISH ("Tiếng Anh giao tiếp") roadmap pillar. Done here, in the
-- same migration as the column itself, so schema and data land together for
-- every environment that runs this migration — never a separate script that
-- could be forgotten after deploy. suitableGoals stays [] (its default) for
-- every other scenario, which is fine: PlacementService.loadAvailableResources
-- queries SpeakingScenario fail-closed (only for goal=GENERAL_ENGLISH, only
-- isFreeTalk rows, requiring an explicit suitableGoals match) — unlike
-- Course/VocabLibrary/ListeningCategory, an empty array here does NOT mean
-- "eligible for every goal".
UPDATE "speaking_scenarios" SET "suitableGoals" = ARRAY['GENERAL_ENGLISH']::"LearningGoal"[] WHERE "isFreeTalk" = true;
