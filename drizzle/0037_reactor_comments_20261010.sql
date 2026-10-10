-- Reactor discussions share moderation, replies and points with video comments.
-- The legacy NOT NULL video_id uses an empty string for reactor-only comments.
ALTER TABLE contributions ADD COLUMN channel_id text REFERENCES channels(id);
CREATE INDEX contributions_channel ON contributions(channel_id,kind,status,created_at);
CREATE TRIGGER contributions_reactor_target_insert BEFORE INSERT ON contributions
WHEN NEW.channel_id IS NOT NULL AND (NEW.kind <> 'comment' OR NEW.video_id <> '')
BEGIN SELECT RAISE(ABORT,'Reactor comments cannot also target a video'); END;
CREATE TRIGGER contributions_reactor_target_update BEFORE UPDATE OF channel_id,video_id,kind ON contributions
WHEN NEW.channel_id IS NOT NULL AND (NEW.kind <> 'comment' OR NEW.video_id <> '')
BEGIN SELECT RAISE(ABORT,'Reactor comments cannot also target a video'); END;
