-- Test feedback (21 October 2026): "it seems that anytime I connect again, a new 'Appareil' is
-- created in the 'Famille'". Every sign-in created a new device row, so one phone piled up as
-- eleven "Téléphone Android".
--
-- The phone now keeps a stable installation id and sends it when it signs in; the API reuses the
-- matching row instead of inserting another one. Nullable: phones built before this keep working
-- (they just fall back to the old one-row-per-sign-in behaviour until they are updated).

ALTER TABLE "devices" ADD COLUMN "install_id" UUID;

-- One lookup per sign-in: (owner, install_id) for this family's parent phones.
CREATE INDEX "devices_owner_user_id_install_id_idx" ON "devices" ("owner_user_id", "install_id");
