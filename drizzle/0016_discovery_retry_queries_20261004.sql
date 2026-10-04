ALTER TABLE channels ADD COLUMN recent_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN recent_retry_at TEXT;
ALTER TABLE channels ADD COLUMN recent_error TEXT;
ALTER TABLE runs ADD COLUMN query_metrics TEXT;
CREATE INDEX IF NOT EXISTS journey_videos_published_channel ON videos(published_at,channel_id,id);
CREATE INDEX IF NOT EXISTS journey_matches_video_performer_status ON matches(video_id,performer_id,status);
CREATE INDEX IF NOT EXISTS journey_exclusions_video_performer ON exclusions(video_id,performer_id);
