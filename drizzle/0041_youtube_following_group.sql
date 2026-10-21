ALTER TABLE following_groups ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual' CHECK(kind IN ('manual','youtube'));
CREATE UNIQUE INDEX following_groups_youtube ON following_groups(user_id) WHERE kind='youtube';
INSERT INTO following_groups(id,user_id,name,follows,active,created_at,kind)
SELECT 'youtube:'||user_id,user_id,'YouTube imports','[]',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'youtube'
FROM youtube_imported_follows GROUP BY user_id;
-- Group switching must not destroy import provenance. Explicit unfollow and
-- disconnect endpoints remove provenance; ordinary follows are only the active view.
DROP TRIGGER journey_activity_unfollow;
CREATE TRIGGER journey_activity_unfollow AFTER DELETE ON follows BEGIN
 INSERT INTO user_activity(user_id,kind,target,summary,created_at)
 SELECT OLD.user_id,'follow',OLD.target,'Unfollowed a '||OLD.kind,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE NOT EXISTS(SELECT 1 FROM youtube_imported_follows i WHERE i.user_id=OLD.user_id AND i.target=OLD.target AND OLD.kind='reactor');
END;
-- Remove the old global import overlay, retaining explicit membership still
-- present in the active manual group's saved snapshot. Do not rewrite snapshots.
DELETE FROM follows WHERE kind='reactor'
AND EXISTS(SELECT 1 FROM youtube_imported_follows i WHERE i.user_id=follows.user_id AND i.target=follows.target)
AND NOT EXISTS(SELECT 1 FROM following_groups g,json_each(g.follows) j
 WHERE g.user_id=follows.user_id AND g.active=1 AND g.kind='manual'
 AND json_extract(j.value,'$.kind')='reactor' AND json_extract(j.value,'$.target')=follows.target);
