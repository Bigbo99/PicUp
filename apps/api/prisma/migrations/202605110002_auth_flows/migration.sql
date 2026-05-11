ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'pending';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);

CREATE TABLE "email_auth_challenges" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "mode" VARCHAR(32) NOT NULL,
    "password_hash" TEXT,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    CONSTRAINT "email_auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_user_id" VARCHAR(160) NOT NULL,
    "union_id" VARCHAR(160),
    "profile" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wechat_login_sessions" (
    "id" UUID NOT NULL,
    "state" VARCHAR(120) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "qr_code_url" TEXT NOT NULL,
    "user_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wechat_login_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'wechat',
    "external_order_id" VARCHAR(160),
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(12) NOT NULL DEFAULT 'CNY',
    "metadata" JSONB,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_auth_challenges_email_created_at_idx" ON "email_auth_challenges"("email", "created_at");
CREATE INDEX "email_auth_challenges_expires_at_idx" ON "email_auth_challenges"("expires_at");

CREATE UNIQUE INDEX "external_identities_provider_provider_user_id_key" ON "external_identities"("provider", "provider_user_id");
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");
CREATE INDEX "external_identities_provider_union_id_idx" ON "external_identities"("provider", "union_id");

CREATE UNIQUE INDEX "wechat_login_sessions_state_key" ON "wechat_login_sessions"("state");
CREATE INDEX "wechat_login_sessions_status_expires_at_idx" ON "wechat_login_sessions"("status", "expires_at");

CREATE UNIQUE INDEX "payment_orders_external_order_id_key" ON "payment_orders"("external_order_id");
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id", "created_at");
CREATE INDEX "payment_orders_status_created_at_idx" ON "payment_orders"("status", "created_at");

ALTER TABLE "email_auth_challenges"
  ADD CONSTRAINT "email_auth_challenges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "external_identities"
  ADD CONSTRAINT "external_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wechat_login_sessions"
  ADD CONSTRAINT "wechat_login_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
