ALTER TABLE channels ADD COLUMN discovery_scope TEXT NOT NULL DEFAULT 'review';
CREATE INDEX channels_discovery_scope_recent ON channels(discovery_scope,recent_attempted_at,recent_checked_at);
UPDATE channels SET discovery_scope='other' WHERE EXISTS(SELECT 1 FROM videos v JOIN matches m ON m.video_id=v.id WHERE v.channel_id=channels.id AND m.performer_id<>'missioned-souls');
UPDATE channels SET discovery_scope='eligible' WHERE EXISTS(SELECT 1 FROM state s WHERE s.key='master-channel-snapshot:'||channels.id) OR EXISTS(SELECT 1 FROM videos v JOIN matches m ON m.video_id=v.id WHERE v.channel_id=channels.id AND m.performer_id='missioned-souls' AND m.status IN ('CONFIRMED','PROBABLE') AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=m.performer_id AND e.video_id=m.video_id));
CREATE TRIGGER missioned_channel_match_insert AFTER INSERT ON matches WHEN NEW.performer_id='missioned-souls' AND NEW.status IN ('CONFIRMED','PROBABLE') BEGIN UPDATE channels SET discovery_scope='eligible' WHERE id=(SELECT channel_id FROM videos WHERE id=NEW.video_id); END;
CREATE TRIGGER missioned_channel_match_update AFTER UPDATE OF status ON matches WHEN NEW.performer_id='missioned-souls' AND NEW.status IN ('CONFIRMED','PROBABLE') BEGIN UPDATE channels SET discovery_scope='eligible' WHERE id=(SELECT channel_id FROM videos WHERE id=NEW.video_id); END;
ALTER TABLE runs ADD COLUMN rows_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN rows_written INTEGER NOT NULL DEFAULT 0;

CREATE TABLE discovery_observations(video_id TEXT PRIMARY KEY, source TEXT NOT NULL, discovered_at TEXT NOT NULL, published_at TEXT, delay_seconds INTEGER);
CREATE INDEX discovery_observations_date ON discovery_observations(discovered_at);
