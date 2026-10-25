-- Folders, as in AEM: sites and library assets can be filed in nested folders
-- (for example Immunology › Calvexa › US). One table for both kinds.
CREATE TABLE IF NOT EXISTS folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('site', 'asset')),
  name        text NOT NULL,
  parent_id   uuid REFERENCES folders(id) ON DELETE CASCADE,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Names are unique among siblings.
CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_name ON folders (kind, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Deleting a folder moves what's in it up a level (done by the API); nothing in it is deleted.
ALTER TABLE library_assets ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS library_assets_folder ON library_assets (folder_id);
CREATE INDEX IF NOT EXISTS sites_folder ON sites (folder_id);

-- The site a template was saved from, so it can be edited there and saved again.
ALTER TABLE site_templates ADD COLUMN IF NOT EXISTS source_site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
