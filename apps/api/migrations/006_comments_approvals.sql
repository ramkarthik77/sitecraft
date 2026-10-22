-- Comments on a branch (whole site, an element, or a CMS item), and approvals before merging.
CREATE TABLE IF NOT EXISTS comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  branch       text NOT NULL,
  target_kind  text NOT NULL DEFAULT 'site' CHECK (target_kind IN ('site', 'node', 'item')),
  target_id    text,
  target_label text NOT NULL DEFAULT '',
  parent_id    uuid REFERENCES comments(id) ON DELETE CASCADE,
  body         text NOT NULL,
  author       text NOT NULL,
  author_role  text NOT NULL,
  resolved_at  timestamptz,
  resolved_by  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_branch ON comments (site_id, branch, created_at);

CREATE TABLE IF NOT EXISTS approvals (
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  branch        text NOT NULL,
  version_id    bigint NOT NULL,
  approver      text NOT NULL,
  approver_role text NOT NULL,
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, branch, version_id, approver)
);

ALTER TABLE sites ADD COLUMN IF NOT EXISTS required_approvals integer NOT NULL DEFAULT 0;
