-- Aligns the data model with the product decisions taken with the design team.

-- 1. "Occupée" and "Indisponible" are the same parent status: keep only `busy`.
UPDATE "parent_presence" SET "availability" = 'busy' WHERE "availability" = 'unavailable';
ALTER TYPE "Availability" RENAME TO "Availability_old";
CREATE TYPE "Availability" AS ENUM ('available', 'busy', 'on_my_way');
ALTER TABLE "parent_presence" ALTER COLUMN "availability" DROP DEFAULT;
ALTER TABLE "parent_presence"
  ALTER COLUMN "availability" TYPE "Availability" USING ("availability"::text::"Availability");
ALTER TABLE "parent_presence" ALTER COLUMN "availability" SET DEFAULT 'available';
DROP TYPE "Availability_old";

-- 2. "Who is speaking" chips on the tablet: a message can be written by several children.
ALTER TABLE "messages" ADD COLUMN "speaker_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
UPDATE "messages" SET "speaker_ids" = ARRAY["sender_id"] WHERE "sender_type" = 'child' AND "sender_id" IS NOT NULL;
