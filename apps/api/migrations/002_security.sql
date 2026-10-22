-- Tokens that expire, can be revoked, and can be limited to some sites.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS site_ids uuid[];
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS created_by text;
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_id ON api_tokens (id);
CREATE INDEX IF NOT EXISTS form_submissions_age ON form_submissions (created_at);
CREATE INDEX IF NOT EXISTS audit_log_age ON audit_log (created_at);
