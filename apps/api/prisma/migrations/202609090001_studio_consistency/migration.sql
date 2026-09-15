ALTER TABLE "image_jobs"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "parent_job_id" UUID;

CREATE TABLE "credit_entries" (
  "key" VARCHAR(160) PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "delta" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "credit_entries_user_id_kind_created_at_idx"
  ON "credit_entries"("user_id", "kind", "created_at");

INSERT INTO "credit_entries" ("key", "user_id", "kind", "delta", "created_at")
SELECT 'job:' || "id" || ':reserve', "user_id", "payment_mode",
  CASE WHEN "payment_mode" = 'credits' THEN -"credits_reserved" ELSE 0 END, "created_at"
FROM "image_jobs" WHERE "user_id" IS NOT NULL;

INSERT INTO "credit_entries" ("key", "user_id", "kind", "delta", "created_at")
SELECT 'job:' || "id" || ':refund', "user_id", 'refund', "credits_reserved", "updated_at"
FROM "image_jobs" WHERE "user_id" IS NOT NULL AND "status" = 'refunded' AND "payment_mode" = 'credits';

INSERT INTO "credit_entries" ("key", "user_id", "kind", "delta", "created_at")
SELECT 'order:' || "id", "user_id", 'recharge', "credits", COALESCE("paid_at", "created_at")
FROM "payment_orders" WHERE "user_id" IS NOT NULL AND "status" = 'paid' AND "order_type" = 'credit_recharge';
