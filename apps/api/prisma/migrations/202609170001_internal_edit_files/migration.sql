ALTER TABLE "files" ADD COLUMN "purpose" VARCHAR(16) NOT NULL DEFAULT 'user';

-- Backfill only requests carrying the exact guide suffix written by the old preview editor.
UPDATE "image_jobs"
SET "edit_options" = COALESCE("edit_options", '{}'::jsonb) || jsonb_build_object(
  'previewOperation', CASE WHEN "edit_options"->>'background' = 'transparent' THEN 'background' ELSE 'annotate' END,
  'guideFileId', "image_ids"->>1,
  'systemFileIds', "image_ids"
), "prompt" = split_part(split_part("prompt", E'\n第一张是原始图片，第二张是标记指引。', 1), E'\n标记 1（', 1)
WHERE "prompt" LIKE E'%\n第一张是原始图片，第二张是标记指引。根据标记定位修改区域，最终结果不要保留任何标记、圈线或蓝色覆盖层，尽量保持未标记区域不变。';

UPDATE "files" f SET "purpose" = 'system'
WHERE EXISTS (SELECT 1 FROM "image_jobs" j WHERE j."edit_options"->>'guideFileId' = f.id::text OR j."edit_options"->>'maskFileId' = f.id::text)
AND NOT EXISTS (SELECT 1 FROM "image_jobs" j WHERE j."edit_options"->>'previewOperation' IS NULL AND j."image_ids" @> to_jsonb(ARRAY[f.id::text]));
