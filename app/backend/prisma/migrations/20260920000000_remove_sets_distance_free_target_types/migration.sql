-- Shrink scheduled_exercises_target_type to only 'repetitions' and 'duration'.
-- PostgreSQL cannot drop enum values in place, so recreate the type and cast
-- the existing column over. Seeded data only ever used repetitions/duration
-- (see prisma/seed-full.ts), so the cast is safe.
BEGIN;

ALTER TYPE "scheduled_exercises_target_type" RENAME TO "scheduled_exercises_target_type_old";

CREATE TYPE "scheduled_exercises_target_type" AS ENUM ('repetitions', 'duration');

ALTER TABLE "scheduled_exercises"
  ALTER COLUMN "target_type" TYPE "scheduled_exercises_target_type"
  USING "target_type"::text::"scheduled_exercises_target_type";

DROP TYPE "scheduled_exercises_target_type_old";

COMMIT;