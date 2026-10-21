-- Restore only direct posts explicitly marked by the old no-reward rule.
-- Preserve existing awards, exclusions, hidden comments, and UTC daily caps.
CREATE TABLE trusted_points_backfill AS
WITH candidates AS (
 SELECT c.id,c.user_id,c.kind,c.created_at,
        CASE c.kind WHEN 'submission' THEN 20 ELSE 3 END amount,
        CASE c.kind WHEN 'submission' THEN 5 ELSE 3 END cap,
        ROW_NUMBER() OVER(PARTITION BY c.user_id,c.kind,substr(c.created_at,1,10) ORDER BY c.created_at,c.id) position,
        (SELECT COUNT(*) FROM points p WHERE p.user_id=c.user_id AND p.kind=c.kind AND p.amount>0 AND substr(p.created_at,1,10)=substr(c.created_at,1,10)) existing
 FROM contributions c
 WHERE c.status='accepted' AND c.kind IN ('comment','submission')
 AND c.review_note='Published directly: verified reputation above 15; no verification rewards awarded.'
 AND NOT EXISTS(SELECT 1 FROM points p WHERE p.id=c.id OR p.id='revoke:'||c.id)
 AND (c.kind='comment' OR (
   EXISTS(SELECT 1 FROM matches m WHERE m.performer_id=c.performer_id AND m.video_id=c.video_id AND m.status='CONFIRMED')
   AND NOT EXISTS(SELECT 1 FROM exclusions e WHERE e.performer_id=c.performer_id AND e.video_id=c.video_id)
 ))
)
SELECT id,user_id,kind,amount,created_at FROM candidates WHERE position+existing<=cap;
INSERT OR IGNORE INTO points(id,user_id,kind,amount,created_at)
SELECT id,user_id,kind,amount,created_at FROM trusted_points_backfill;
INSERT OR IGNORE INTO state(key,value)
SELECT 'trusted-member-points-backfill-v1',json_object('awards',COUNT(*),'points',COALESCE(SUM(amount),0),'members',COUNT(DISTINCT user_id),'appliedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
FROM trusted_points_backfill;
DROP TABLE trusted_points_backfill;
