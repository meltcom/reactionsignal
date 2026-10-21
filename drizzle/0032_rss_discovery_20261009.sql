ALTER TABLE push_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'YouTube upload notification';
CREATE TABLE rss_checks(channel_id TEXT PRIMARY KEY, checked_at TEXT NOT NULL, retry_at TEXT, error TEXT);
CREATE INDEX rss_checks_date ON rss_checks(checked_at);
CREATE TABLE notification_receipts(video_id TEXT NOT NULL, source TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT, PRIMARY KEY(video_id,source));
CREATE INDEX notification_receipts_date ON notification_receipts(received_at);
