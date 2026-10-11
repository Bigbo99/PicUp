-- DropForeignKey
ALTER TABLE "studio_asset_metadata" DROP CONSTRAINT "studio_asset_metadata_user_id_fkey";

-- DropForeignKey
ALTER TABLE "studio_conversation_metadata" DROP CONSTRAINT "studio_conversation_metadata_user_id_fkey";

-- DropForeignKey
ALTER TABLE "studio_preferences" DROP CONSTRAINT "studio_preferences_user_id_fkey";

-- DropIndex
DROP INDEX "payment_orders_user_id_status_created_at_idx";

-- AlterTable
ALTER TABLE "studio_conversation_metadata" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_preferences" ADD CONSTRAINT "studio_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_asset_metadata" ADD CONSTRAINT "studio_asset_metadata_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_conversation_metadata" ADD CONSTRAINT "studio_conversation_metadata_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
