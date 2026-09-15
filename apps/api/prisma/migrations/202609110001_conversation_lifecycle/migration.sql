CREATE TABLE "studio_conversation_metadata" (
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "root_job_id" UUID NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "root_job_id")
);

CREATE INDEX "studio_conversation_metadata_user_id_archived_updated_at_idx"
  ON "studio_conversation_metadata"("user_id", "archived", "updated_at");
