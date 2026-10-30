-- Preserve the audit history while removing credentials copied from user rows.
UPDATE "audit_logs"
SET "before" = CASE WHEN jsonb_typeof("before") = 'object'
      THEN "before" - ARRAY['passwordHash', 'password_hash', 'password', 'codeHash', 'code_hash', 'apiKey', 'api_key']
      ELSE "before" END,
    "after" = CASE WHEN jsonb_typeof("after") = 'object'
      THEN "after" - ARRAY['passwordHash', 'password_hash', 'password', 'codeHash', 'code_hash', 'apiKey', 'api_key']
      ELSE "after" END
WHERE "before" ?| ARRAY['passwordHash', 'password_hash', 'password', 'codeHash', 'code_hash', 'apiKey', 'api_key']
   OR "after" ?| ARRAY['passwordHash', 'password_hash', 'password', 'codeHash', 'code_hash', 'apiKey', 'api_key'];

-- Older edits could disable an account without revoking its existing sessions.
UPDATE "user_sessions" AS session
SET "revoked_at" = CURRENT_TIMESTAMP
FROM "users" AS account
WHERE session."user_id" = account."id"
  AND account."status" <> 'active'
  AND session."revoked_at" IS NULL;
