ALTER TABLE "image_jobs"
  ADD COLUMN "count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "credits_refunded" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "image_jobs"
  ADD CONSTRAINT "image_jobs_count_check" CHECK ("count" BETWEEN 1 AND 4);
