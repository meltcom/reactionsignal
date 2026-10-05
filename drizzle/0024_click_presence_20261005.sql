ALTER TABLE members ADD COLUMN active_at TEXT;
CREATE INDEX journey_members_active ON members(active_at DESC,id);
