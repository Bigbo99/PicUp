-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('guest', 'user', 'admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "ImageJobStatus" AS ENUM ('queued', 'running', 'retrying', 'succeeded', 'failed', 'refunded');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255),
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'guest',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "is_guest" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "url" TEXT NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "mode" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "template" VARCHAR(80) NOT NULL,
    "prompt" TEXT NOT NULL,
    "image_ids" JSONB NOT NULL,
    "aspect_ratio" VARCHAR(24) NOT NULL,
    "quality" VARCHAR(24) NOT NULL,
    "status" "ImageJobStatus" NOT NULL DEFAULT 'queued',
    "selected_provider" VARCHAR(32) NOT NULL,
    "selected_model" VARCHAR(120) NOT NULL,
    "final_prompt" TEXT NOT NULL,
    "input_files" JSONB NOT NULL,
    "output_images" JSONB NOT NULL DEFAULT '[]',
    "text_outputs" JSONB NOT NULL DEFAULT '[]',
    "error" JSONB,
    "credits_reserved" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "image_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_configs" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "max_input_images" INTEGER NOT NULL DEFAULT 1,
    "supported_ratios" JSONB NOT NULL,
    "supported_qualities" JSONB NOT NULL,
    "cost_credits" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "target" VARCHAR(120) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "files_user_id_created_at_idx" ON "files"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "image_jobs_user_id_created_at_idx" ON "image_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "image_jobs_status_created_at_idx" ON "image_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "model_configs_provider_enabled_priority_idx" ON "model_configs"("provider", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "model_configs_provider_model_key" ON "model_configs"("provider", "model");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_created_at_idx" ON "audit_logs"("target", "created_at");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_jobs" ADD CONSTRAINT "image_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

