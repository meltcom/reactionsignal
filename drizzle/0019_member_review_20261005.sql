ALTER TABLE members ADD COLUMN email TEXT;
ALTER TABLE members ADD COLUMN last_seen_at TEXT;
CREATE INDEX IF NOT EXISTS journey_members_created ON members(created_at DESC,id);
