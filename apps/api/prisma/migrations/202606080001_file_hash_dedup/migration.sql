-- Add content hash for uploaded images so duplicate uploads can reuse the same stored object.
ALTER TABLE "files" ADD COLUMN "hash" VARCHAR(64);

-- Keep one file record per user and file hash.
CREATE UNIQUE INDEX "files_user_id_hash_key" ON "files"("user_id", "hash");
