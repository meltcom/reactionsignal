CREATE TABLE IF NOT EXISTS video_corrections (
 id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id),
 moderator_id TEXT NOT NULL, note TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS video_corrections_video_date ON video_corrections(video_id,created_at DESC);
