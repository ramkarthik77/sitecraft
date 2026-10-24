-- Running regulated sites: where each site sits in the portfolio, job codes,
-- MLR reviews with signed approvals, asset approval and market rights, the
-- person behind each Claude token, and an audit trail that shows tampering.

-- Where a site sits: therapy area › brand › market › audience.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS therapy_area text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS market text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS audience text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS job_code text;
-- Review disciplines that must each sign off (for example medical, legal, regulatory).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS review_disciplines text[] NOT NULL DEFAULT '{}';
-- When on, every page needs a job code before the site is published.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS require_job_codes boolean NOT NULL DEFAULT false;

-- Which disciplines a person reviews for, and the person a Claude token works for.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS disciplines text[] NOT NULL DEFAULT '{}';
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS on_behalf_of text;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS on_behalf_of text;

-- Approvals record the discipline and an electronic signature.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS discipline text NOT NULL DEFAULT '';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS signature jsonb;

-- Library assets: approval status, job code, the markets they're cleared for, and their brand.
ALTER TABLE library_assets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
ALTER TABLE library_assets ADD COLUMN IF NOT EXISTS job_code text NOT NULL DEFAULT '';
ALTER TABLE library_assets ADD COLUMN IF NOT EXISTS markets text[] NOT NULL DEFAULT '{}';
ALTER TABLE library_assets ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES brands(id) ON DELETE SET NULL;

-- A request for MLR review of a branch, and everything that happens to it.
CREATE TABLE IF NOT EXISTS review_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  branch            text NOT NULL,
  title             text NOT NULL,
  note              text NOT NULL DEFAULT '',
  job_code          text NOT NULL DEFAULT '',
  due_at            timestamptz,
  status            text NOT NULL DEFAULT 'open',
  version_id        bigint NOT NULL,
  requested_by      text NOT NULL,
  requested_by_role text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_requests_site ON review_requests (site_id, status);
CREATE INDEX IF NOT EXISTS review_requests_open ON review_requests (status, due_at);

CREATE TABLE IF NOT EXISTS review_events (
  id          bigserial PRIMARY KEY,
  review_id   uuid NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE,
  actor       text NOT NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  discipline  text NOT NULL DEFAULT '',
  reason      text NOT NULL DEFAULT '',
  version_id  bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_events_review ON review_events (review_id, id);

-- When each person last looked at their notifications.
CREATE TABLE IF NOT EXISTS notification_reads (
  actor    text PRIMARY KEY,
  seen_at  timestamptz NOT NULL
);

-- Tamper-evident audit trail. Each entry stores the hash of the one before it
-- and a hash of itself, in a strict sequence. Changing, removing or reordering
-- entries outside Sitecraft breaks the chain, and the check below finds where.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS seq bigint;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hash text;

CREATE OR REPLACE FUNCTION audit_entry_hash(prev text, seq bigint, id bigint, site uuid, actor text, role text, action text, detail jsonb, at timestamptz) RETURNS text AS $$
  SELECT encode(sha256(convert_to(concat_ws(E'\x1f', COALESCE(prev, ''), seq::text, id::text, COALESCE(site::text, ''), actor, role, action, detail::text,
    to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8')), 'hex');
$$ LANGUAGE sql IMMUTABLE;

-- Link existing entries in the order they were written.
ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change;
DO $$
DECLARE r record; last text := NULL; n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id LOOP
    n := n + 1;
    UPDATE audit_log SET seq = n, prev_hash = last,
      hash = audit_entry_hash(last, n, r.id, r.site_id, r.actor, r.actor_role, r.action, r.detail, r.created_at)
      WHERE id = r.id RETURNING hash INTO last;
  END LOOP;
END $$;
ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change;
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_seq ON audit_log (seq);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at DESC);

-- New entries join the chain one at a time, so the order is never ambiguous.
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger AS $$
DECLARE last_seq bigint; last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(727002);
  SELECT seq, hash INTO last_seq, last_hash FROM audit_log ORDER BY seq DESC NULLS LAST LIMIT 1;
  NEW.seq := COALESCE(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.hash := audit_entry_hash(last_hash, NEW.seq, NEW.id, NEW.site_id, NEW.actor, NEW.actor_role, NEW.action, NEW.detail, NEW.created_at);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_chain ON audit_log;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_chain();
