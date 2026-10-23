CREATE TRIGGER IF NOT EXISTS official_channel_no_reaction_insert BEFORE INSERT ON matches WHEN NEW.performer_id='missioned-souls' AND EXISTS(SELECT 1 FROM videos WHERE id=NEW.video_id AND channel_id='UCeTfwcnUVurw7Qrk_KF5Idw') BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS official_channel_no_reaction_update BEFORE UPDATE ON matches WHEN NEW.performer_id='missioned-souls' AND EXISTS(SELECT 1 FROM videos WHERE id=NEW.video_id AND channel_id='UCeTfwcnUVurw7Qrk_KF5Idw') BEGIN SELECT RAISE(IGNORE); END;
INSERT OR IGNORE INTO exclusions(performer_id,video_id,reason) SELECT 'missioned-souls',id,'Official Missioned Souls channel; not a reaction' FROM videos WHERE channel_id='UCeTfwcnUVurw7Qrk_KF5Idw';
DELETE FROM matches WHERE performer_id='missioned-souls' AND video_id IN(SELECT id FROM videos WHERE channel_id='UCeTfwcnUVurw7Qrk_KF5Idw');
UPDATE channels SET discovery_scope='other',scope_locked=1 WHERE id='UCeTfwcnUVurw7Qrk_KF5Idw';
UPDATE discovery_notifications SET status='removed',note='Official Missioned Souls upload; not a reaction' WHERE performer_id='missioned-souls' AND video_id IN(SELECT id FROM videos WHERE channel_id='UCeTfwcnUVurw7Qrk_KF5Idw');
