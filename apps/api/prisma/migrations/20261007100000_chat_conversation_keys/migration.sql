-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "direct_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_direct_key_key" ON "conversations"("direct_key");

-- One group conversation per family
CREATE UNIQUE INDEX "conversations_family_group_key" ON "conversations" ("family_id") WHERE "is_group";
