-- One image library for every site, with metadata people and Claude search.
CREATE TABLE IF NOT EXISTS library_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name    text NOT NULL,
  ext          text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  width        integer,
  height       integer,
  title        text NOT NULL DEFAULT '',
  alt          text NOT NULL DEFAULT '',
  credit       text NOT NULL DEFAULT '',
  tags         jsonb NOT NULL DEFAULT '[]',
  focal_x      real NOT NULL DEFAULT 0.5,
  focal_y      real NOT NULL DEFAULT 0.5,
  expires_at   timestamptz,
  version      integer NOT NULL DEFAULT 1,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_assets_recent ON library_assets (created_at DESC);
