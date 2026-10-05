ALTER TABLE channels ADD COLUMN scope_locked INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER missioned_channel_match_insert;
DROP TRIGGER missioned_channel_match_update;
CREATE TRIGGER missioned_channel_match_insert AFTER INSERT ON matches WHEN NEW.performer_id='missioned-souls' AND NEW.status IN ('CONFIRMED','PROBABLE') BEGIN UPDATE channels SET discovery_scope='eligible' WHERE scope_locked=0 AND id=(SELECT channel_id FROM videos WHERE id=NEW.video_id); END;
CREATE TRIGGER missioned_channel_match_update AFTER UPDATE OF status ON matches WHEN NEW.performer_id='missioned-souls' AND NEW.status IN ('CONFIRMED','PROBABLE') BEGIN UPDATE channels SET discovery_scope='eligible' WHERE scope_locked=0 AND id=(SELECT channel_id FROM videos WHERE id=NEW.video_id); END;
