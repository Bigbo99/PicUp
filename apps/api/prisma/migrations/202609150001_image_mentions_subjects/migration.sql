ALTER TABLE "image_jobs" ADD COLUMN "prompt_parts" JSONB;

CREATE TABLE "studio_subjects" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000) NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_subjects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_subjects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "studio_subjects_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "studio_subjects_user_id_created_at_idx" ON "studio_subjects"("user_id", "created_at");
