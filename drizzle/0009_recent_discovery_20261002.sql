ALTER TABLE channels ADD COLUMN recent_checked_at TEXT;
ALTER TABLE channels ADD COLUMN history_checked_at TEXT;
ALTER TABLE channels ADD COLUMN recent_attempted_at TEXT;
ALTER TABLE runs ADD COLUMN history_pages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN recent_added INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN history_added INTEGER NOT NULL DEFAULT 0;
CREATE INDEX rs_channels_recent_checked ON channels(recent_checked_at);
CREATE INDEX rs_channels_recent_attempted ON channels(recent_attempted_at,recent_checked_at,id);
CREATE INDEX rs_channels_history_checked ON channels(history_checked_at,id) WHERE next_page IS NOT NULL;
