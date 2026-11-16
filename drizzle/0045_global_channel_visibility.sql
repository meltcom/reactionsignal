-- Moderators can temporarily hide a reactor channel and its videos from all users.
-- Original catalog records are retained so visibility can be restored.
ALTER TABLE channels ADD COLUMN hidden_at TEXT;
ALTER TABLE channels ADD COLUMN hidden_by TEXT;
ALTER TABLE channels ADD COLUMN hidden_reason TEXT;
CREATE INDEX channels_visibility_idx ON channels(hidden_at,id);
ALTER TABLE channels ADD COLUMN removed_at TEXT;
ALTER TABLE channels ADD COLUMN removed_by TEXT;
ALTER TABLE channels ADD COLUMN removal_reason TEXT;
CREATE INDEX channels_removal_idx ON channels(removed_at,id);
