-- "Créer mon avatar": custom avatars are stored as a small JSON list of choices (no photo).
ALTER TABLE "users" ADD COLUMN "avatar_spec" JSONB;
ALTER TABLE "child_profiles" ADD COLUMN "avatar_spec" JSONB;

-- A parent must allow each child to use the tablet camera in the avatar maker.
ALTER TABLE "child_profiles" ADD COLUMN "avatar_camera_allowed" BOOLEAN NOT NULL DEFAULT false;
