ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip" VARCHAR(80);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" VARCHAR(512);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "request_id" VARCHAR(120);

CREATE INDEX IF NOT EXISTS "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
