CREATE TABLE IF NOT EXISTS video_corrections (
 id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id),
 moderator_id TEXT NOT NULL, note TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS video_corrections_video_date ON video_corrections(video_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS missioned_video_channel_corrected
AFTER UPDATE OF channel_id ON videos WHEN OLD.channel_id IS NOT NEW.channel_id
BEGIN
 UPDATE channels SET discovery_scope='eligible'
 WHERE id=NEW.channel_id AND scope_locked=0
 AND EXISTS(SELECT 1 FROM matches m WHERE m.video_id=NEW.id
   AND m.performer_id='missioned-souls' AND m.status IN ('CONFIRMED','PROBABLE')
   AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.video_id=m.video_id AND e.performer_id=m.performer_id));
END;
