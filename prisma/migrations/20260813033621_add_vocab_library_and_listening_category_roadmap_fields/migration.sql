-- AlterTable
ALTER TABLE "listening_categories" ADD COLUMN     "level" "CefrLevel",
ADD COLUMN     "suitableGoals" "LearningGoal"[] DEFAULT ARRAY[]::"LearningGoal"[];

-- AlterTable
ALTER TABLE "vocab_libraries" ADD COLUMN     "level" "CefrLevel",
ADD COLUMN     "suitableGoals" "LearningGoal"[] DEFAULT ARRAY[]::"LearningGoal"[];
