-- Publish main, or merge a branch and publish it (a release), at a set time.
CREATE TABLE IF NOT EXISTS schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  branch       text NOT NULL,
  run_at       timestamptz NOT NULL,
  note         text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  result       text,
  created_by   text NOT NULL,
  created_role text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS schedules_due ON schedules (status, run_at);
CREATE INDEX IF NOT EXISTS schedules_site ON schedules (site_id, run_at DESC);
