CREATE INDEX IF NOT EXISTS journey_videos_checked_id ON videos(checked_at,id);
CREATE INDEX IF NOT EXISTS journey_history_ready ON channels(history_checked_at,id) WHERE discovery_scope='eligible' AND uploads IS NOT NULL AND next_page IS NOT NULL;
