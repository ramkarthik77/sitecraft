-- History you can read: what each version changed, names for the ones that
-- matter, what kind of save it was, and every moment the live site changed.

ALTER TABLE versions ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'edit';
ALTER TABLE versions ADD COLUMN IF NOT EXISTS changes jsonb;
UPDATE versions SET kind = 'create' WHERE parent_id IS NULL AND message = 'Create site';
UPDATE versions SET kind = 'merge' WHERE message LIKE 'Merge branch %';
UPDATE versions SET kind = 'restore' WHERE message LIKE 'Restore version %';

-- Old edits are condensed over time; a version whose parent goes keeps its place.
ALTER TABLE versions DROP CONSTRAINT IF EXISTS versions_parent_id_fkey;
ALTER TABLE versions ADD CONSTRAINT versions_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES versions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS versions_site_created ON versions (site_id, created_at);

-- Each time a site's live version changed: a publish or a rollback.
CREATE TABLE IF NOT EXISTS live_history (
  id            bigserial PRIMARY KEY,
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  deployment_id uuid NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  actor         text NOT NULL,
  reason        text NOT NULL DEFAULT 'publish',
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_history_site_at ON live_history (site_id, at DESC);
INSERT INTO live_history (site_id, deployment_id, actor, reason, at)
  SELECT d.site_id, d.id, d.actor, 'publish', d.created_at FROM deployments d
  WHERE NOT EXISTS (SELECT 1 FROM live_history h WHERE h.deployment_id = d.id);

-- The audit trail is append-only: nothing can change or remove an entry, from
-- any code path. (Regulated teams need a record that outlives edit history.)
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only: entries can''t be changed or deleted.';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
