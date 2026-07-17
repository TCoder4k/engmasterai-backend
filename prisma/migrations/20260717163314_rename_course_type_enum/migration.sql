-- AlterEnum
-- Safe rename: courses table is empty at time of writing, no data migration needed.
BEGIN;
CREATE TYPE "CourseType_new" AS ENUM ('GRAMMAR', 'VOCABULARY', 'LISTENING');
ALTER TABLE "courses" ALTER COLUMN "type" TYPE "CourseType_new" USING ("type"::text::"CourseType_new");
ALTER TYPE "CourseType" RENAME TO "CourseType_old";
ALTER TYPE "CourseType_new" RENAME TO "CourseType";
DROP TYPE "CourseType_old";
COMMIT;
