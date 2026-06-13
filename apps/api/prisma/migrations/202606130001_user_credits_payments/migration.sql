ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credit_balance" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "payment_orders"
  ADD COLUMN IF NOT EXISTS "order_type" VARCHAR(32) NOT NULL DEFAULT 'credit_recharge',
  ADD COLUMN IF NOT EXISTS "credits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "image_jobs"
  ADD COLUMN IF NOT EXISTS "payment_mode" VARCHAR(32) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS "payment_order_id" UUID;

CREATE INDEX IF NOT EXISTS "payment_orders_user_id_status_created_at_idx"
  ON "payment_orders"("user_id", "status", "created_at");
