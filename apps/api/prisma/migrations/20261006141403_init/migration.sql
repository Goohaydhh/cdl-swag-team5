-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('parent_phone', 'child_tablet');

-- CreateEnum
CREATE TYPE "PairingKind" AS ENUM ('tablet_pairing', 'parent_invite');

-- CreateEnum
CREATE TYPE "PairingState" AS ENUM ('pending', 'claimed', 'approved', 'rejected', 'consumed', 'expired');

-- CreateEnum
CREATE TYPE "ChildStatus" AS ENUM ('at_home', 'left_home', 'at_friend');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('available', 'busy', 'on_my_way', 'unavailable');

-- CreateEnum
CREATE TYPE "RingerMode" AS ENUM ('normal', 'vibrate', 'silent', 'unknown');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'child', 'system');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('text', 'gif', 'sticker', 'drawing', 'system');

-- CreateEnum
CREATE TYPE "UrlMatch" AS ENUM ('exact', 'domain', 'prefix');

-- CreateTable
CREATE TABLE "families" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status_retention_days" INTEGER NOT NULL DEFAULT 30,
    "message_retention_days" INTEGER NOT NULL DEFAULT 90,
    "allowlist_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erasure_requested_at" TIMESTAMPTZ,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_key" TEXT,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "admin_pin_hash" TEXT,
    "consent_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_profiles" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "display_name" VARCHAR(30) NOT NULL,
    "avatar_key" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "pin_hash" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "kind" "DeviceKind" NOT NULL,
    "owner_user_id" UUID,
    "name" TEXT NOT NULL,
    "platform_info" JSONB NOT NULL DEFAULT '{}',
    "credential_hash" TEXT,
    "push_token" TEXT,
    "last_seen_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_child_profiles" (
    "device_id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,

    CONSTRAINT "device_child_profiles_pkey" PRIMARY KEY ("device_id","child_profile_id")
);

-- CreateTable
CREATE TABLE "pairing_sessions" (
    "id" UUID NOT NULL,
    "kind" "PairingKind" NOT NULL,
    "state" "PairingState" NOT NULL DEFAULT 'pending',
    "family_id" UUID,
    "created_by" UUID,
    "claimed_by" UUID,
    "code_hash" TEXT NOT NULL,
    "secret_hash" TEXT,
    "device_info" JSONB NOT NULL DEFAULT '{}',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "token_hash" TEXT NOT NULL,
    "token_family" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_events" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "child_profile_id" UUID NOT NULL,
    "device_id" UUID,
    "status" "ChildStatus" NOT NULL,
    "note" VARCHAR(80),
    "client_event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_current_status" (
    "child_profile_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "status" "ChildStatus" NOT NULL,
    "event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "child_current_status_pkey" PRIMARY KEY ("child_profile_id")
);

-- CreateTable
CREATE TABLE "parent_presence" (
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'available',
    "eta_minutes" SMALLINT,
    "availability_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ringer" "RingerMode" NOT NULL DEFAULT 'unknown',
    "ringer_at" TIMESTAMPTZ,

    CONSTRAINT "parent_presence_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "conversation_id" UUID NOT NULL,
    "member_type" "ActorType" NOT NULL,
    "member_id" UUID NOT NULL,
    "last_read_id" UUID,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversation_id","member_type","member_id")
);

-- CreateTable
CREATE TABLE "media_objects" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "sender_type" "ActorType" NOT NULL,
    "sender_id" UUID,
    "kind" "MessageKind" NOT NULL,
    "body" VARCHAR(2000),
    "media_id" UUID,
    "sticker_code" TEXT,
    "gif_ref" TEXT,
    "client_msg_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allowed_urls" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "child_profile_id" UUID,
    "match" "UrlMatch" NOT NULL,
    "host" TEXT NOT NULL,
    "path_prefix" TEXT NOT NULL DEFAULT '/',
    "title" TEXT NOT NULL,
    "icon_key" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowed_urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "family_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "pairing_sessions_code_hash_idx" ON "pairing_sessions"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "status_events_child_profile_id_occurred_at_idx" ON "status_events"("child_profile_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "status_events_device_id_client_event_id_key" ON "status_events"("device_id", "client_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "child_current_status_event_id_key" ON "child_current_status"("event_id");

-- CreateIndex
CREATE INDEX "child_current_status_family_id_idx" ON "child_current_status"("family_id");

-- CreateIndex
CREATE INDEX "parent_presence_family_id_idx" ON "parent_presence"("family_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_id_idx" ON "messages"("conversation_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "messages_sender_type_sender_id_client_msg_id_key" ON "messages"("sender_type", "sender_id", "client_msg_id");

-- CreateIndex
CREATE UNIQUE INDEX "allowed_urls_family_id_child_profile_id_match_host_path_pre_key" ON "allowed_urls"("family_id", "child_profile_id", "match", "host", "path_prefix");

-- CreateIndex
CREATE INDEX "audit_log_family_id_created_at_idx" ON "audit_log"("family_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_child_profiles" ADD CONSTRAINT "device_child_profiles_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_child_profiles" ADD CONSTRAINT "device_child_profiles_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_sessions" ADD CONSTRAINT "pairing_sessions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_sessions" ADD CONSTRAINT "pairing_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_sessions" ADD CONSTRAINT "pairing_sessions_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_current_status" ADD CONSTRAINT "child_current_status_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_current_status" ADD CONSTRAINT "child_current_status_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "status_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_presence" ADD CONSTRAINT "parent_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_urls" ADD CONSTRAINT "allowed_urls_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_urls" ADD CONSTRAINT "allowed_urls_child_profile_id_fkey" FOREIGN KEY ("child_profile_id") REFERENCES "child_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_urls" ADD CONSTRAINT "allowed_urls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only one live pairing session per code (section 5.2)
CREATE UNIQUE INDEX "pairing_sessions_live_code_hash_key" ON "pairing_sessions" ("code_hash") WHERE "state" IN ('pending', 'claimed');
