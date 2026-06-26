ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_ip" VARCHAR(80);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_country" VARCHAR(120);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_region" VARCHAR(120);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_city" VARCHAR(120);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_is_guest_last_country_idx" ON "users"("is_guest", "last_country");
CREATE INDEX IF NOT EXISTS "users_is_guest_last_seen_at_idx" ON "users"("is_guest", "last_seen_at");
