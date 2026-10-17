-- A user may hold PRO and PREMIUM independently. The original migration
-- incorrectly made userId unique by itself, which prevented the compound
-- upsert used by payment and admin subscription flows.
DROP INDEX IF EXISTS "subscriptions_userId_key";

CREATE UNIQUE INDEX "subscriptions_userId_plan_key"
  ON "subscriptions"("userId", "plan");
