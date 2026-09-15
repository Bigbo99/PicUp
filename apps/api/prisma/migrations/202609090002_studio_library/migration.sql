CREATE TABLE "studio_preferences" (
  "user_id" UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "settings" JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE "studio_asset_metadata" (
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL,
  "title" VARCHAR(120),
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("user_id", "key")
);
