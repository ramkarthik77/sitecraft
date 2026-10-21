CREATE TABLE IF NOT EXISTS sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  domain      text UNIQUE,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  current_deployment_id uuid
);

CREATE TABLE IF NOT EXISTS versions (
  id          bigserial PRIMARY KEY,
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  branch      text NOT NULL,
  parent_id   bigint REFERENCES versions(id),
  document    jsonb NOT NULL,
  message     text NOT NULL DEFAULT '',
  actor       text NOT NULL,
  actor_role  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS versions_site_branch ON versions (site_id, branch, id DESC);

CREATE TABLE IF NOT EXISTS branches (
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name            text NOT NULL,
  head_version_id bigint NOT NULL REFERENCES versions(id),
  base_version_id bigint REFERENCES versions(id),
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  merged_at       timestamptz,
  PRIMARY KEY (site_id, name)
);

CREATE TABLE IF NOT EXISTS deployments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_id  bigint NOT NULL REFERENCES versions(id),
  url         text NOT NULL,
  files       jsonb NOT NULL,
  actor       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deployments_site ON deployments (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS form_submissions (
  id          bigserial PRIMARY KEY,
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  form        text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS form_submissions_site ON form_submissions (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash  text PRIMARY KEY,
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'editor', 'agent')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  site_id     uuid,
  actor       text NOT NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_site ON audit_log (site_id, created_at DESC);
