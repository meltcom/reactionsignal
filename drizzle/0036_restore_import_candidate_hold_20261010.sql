-- The seed deliberately holds this candidate; historical migrations inserted PROBABLE first.
-- Restore only untouched import-owned rows, preserving later moderator decisions.
INSERT OR IGNORE INTO state(key,value)
SELECT 'candidate-hold-repair:gXWQQNUpKcA',json_object('beforeStatus',m.status,'beforeSource',m.source,'afterStatus','PENDING','reason','Restore original candidate hold bypassed by historical import','at',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
FROM matches m WHERE m.performer_id='missioned-souls' AND m.video_id='gXWQQNUpKcA'
 AND m.status='PROBABLE' AND m.source IN ('Reconciled master/CSV historical import 2026-09-30','Reconciled historical import 2026-10-02')
 AND NOT EXISTS(SELECT 1 FROM video_corrections WHERE video_id=m.video_id)
 AND NOT EXISTS(SELECT 1 FROM contributions WHERE video_id=m.video_id AND performer_id=m.performer_id AND status='accepted')
 AND NOT EXISTS(SELECT 1 FROM exclusions WHERE video_id=m.video_id AND performer_id=m.performer_id);
UPDATE matches SET status='PENDING',source='Historical import candidate held for moderator review'
WHERE performer_id='missioned-souls' AND video_id='gXWQQNUpKcA' AND status='PROBABLE'
 AND source IN ('Reconciled master/CSV historical import 2026-09-30','Reconciled historical import 2026-10-02')
 AND NOT EXISTS(SELECT 1 FROM video_corrections WHERE video_id='gXWQQNUpKcA')
 AND NOT EXISTS(SELECT 1 FROM contributions WHERE video_id='gXWQQNUpKcA' AND performer_id='missioned-souls' AND status='accepted')
 AND NOT EXISTS(SELECT 1 FROM exclusions WHERE video_id='gXWQQNUpKcA' AND performer_id='missioned-souls');
