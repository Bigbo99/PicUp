ALTER TABLE "image_jobs"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lease_owner" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "image_jobs_user_id_idempotency_key_key"
  ON "image_jobs"("user_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "image_jobs_payment_order_id_key"
  ON "image_jobs"("payment_order_id");
CREATE INDEX IF NOT EXISTS "image_jobs_status_lease_expires_at_idx"
  ON "image_jobs"("status", "lease_expires_at");
