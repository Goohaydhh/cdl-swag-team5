-- A family-wide rule has child_profile_id NULL. Plain UNIQUE treats NULLs as distinct, which let the
-- same family-wide rule be added twice. Keep the oldest of any duplicates, then rebuild the index
-- with NULLS NOT DISTINCT under the same name, so Prisma still recognises it.
DELETE FROM "allowed_urls" a
USING "allowed_urls" b
WHERE a."family_id" = b."family_id"
  AND a."child_profile_id" IS NOT DISTINCT FROM b."child_profile_id"
  AND a."match" = b."match"
  AND a."host" = b."host"
  AND a."path_prefix" = b."path_prefix"
  AND (a."created_at", a."id") > (b."created_at", b."id");

DROP INDEX IF EXISTS "allowed_urls_family_id_child_profile_id_match_host_path_pre_key";
CREATE UNIQUE INDEX "allowed_urls_family_id_child_profile_id_match_host_path_pre_key"
  ON "allowed_urls" ("family_id", "child_profile_id", "match", "host", "path_prefix") NULLS NOT DISTINCT;
