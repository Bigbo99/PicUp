-- Add indexes used by studio conversation and job status queries.
CREATE INDEX "image_jobs_user_id_parent_job_id_created_at_idx"
  ON "image_jobs"("user_id", "parent_job_id", "created_at");
CREATE INDEX "image_jobs_user_id_status_created_at_idx"
  ON "image_jobs"("user_id", "status", "created_at");
CREATE INDEX "image_jobs_user_id_payment_mode_created_at_status_idx"
  ON "image_jobs"("user_id", "payment_mode", "created_at", "status");
