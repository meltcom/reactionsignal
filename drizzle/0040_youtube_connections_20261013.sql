CREATE TABLE youtube_connections(user_id TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, token_cipher TEXT NOT NULL, verified_at INTEGER NOT NULL, checked_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX youtube_connections_check ON youtube_connections(checked_at);
CREATE TABLE youtube_oauth_states(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,verifier_cipher TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE youtube_imported_follows(user_id TEXT NOT NULL,target TEXT NOT NULL,connection_id TEXT NOT NULL,PRIMARY KEY(user_id,target));
CREATE INDEX youtube_imported_connection ON youtube_imported_follows(connection_id);
CREATE TABLE youtube_revoke_jobs(id TEXT PRIMARY KEY,token_cipher TEXT NOT NULL,created_at INTEGER NOT NULL);
DROP TRIGGER journey_activity_follow;
DROP TRIGGER journey_activity_unfollow;
CREATE TRIGGER journey_activity_follow AFTER INSERT ON follows WHEN NOT EXISTS(SELECT 1 FROM youtube_imported_follows i WHERE i.user_id=NEW.user_id AND i.target=NEW.target AND NEW.kind='reactor') BEGIN INSERT INTO user_activity(user_id,kind,target,summary,created_at) VALUES(NEW.user_id,'follow',NEW.target,'Followed a '||NEW.kind,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER journey_activity_unfollow AFTER DELETE ON follows BEGIN
INSERT INTO user_activity(user_id,kind,target,summary,created_at) SELECT OLD.user_id,'follow',OLD.target,'Unfollowed a '||OLD.kind,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM youtube_imported_follows i WHERE i.user_id=OLD.user_id AND i.target=OLD.target AND OLD.kind='reactor');
DELETE FROM youtube_imported_follows WHERE user_id=OLD.user_id AND target=OLD.target AND OLD.kind='reactor';
END;
