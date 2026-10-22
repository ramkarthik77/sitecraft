-- Brand kits shared by sites, and saved site templates.
CREATE TABLE IF NOT EXISTS brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  locked      boolean NOT NULL DEFAULT false,
  theme       jsonb NOT NULL,
  logo        text,
  guidelines  text,
  components  jsonb NOT NULL DEFAULT '[]',
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS brands_name ON brands (lower(name));

ALTER TABLE sites ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES brands(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS site_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  document    jsonb NOT NULL,
  source_name text NOT NULL DEFAULT '',
  brand_id    uuid REFERENCES brands(id) ON DELETE SET NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_templates_name ON site_templates (lower(name));
