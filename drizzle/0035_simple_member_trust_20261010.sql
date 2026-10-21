-- Keep existing direct-post privileges while retiring reputation as an access gate.
ALTER TABLE members ADD COLUMN trusted INTEGER NOT NULL DEFAULT 0 CHECK(trusted IN (0,1));
ALTER TABLE members ADD COLUMN trust_reviewed_at TEXT;
CREATE TABLE member_trust_history (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES members(id),
 moderator_id TEXT,
 trusted INTEGER NOT NULL CHECK(trusted IN (0,1)),
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL
);
UPDATE members SET trusted=1,trust_reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT COALESCE(SUM(amount),0) FROM reputation_events WHERE user_id=members.id)>15;
INSERT INTO member_trust_history(id,user_id,moderator_id,trusted,reason,created_at)
SELECT 'trust-migration:'||id,id,NULL,1,'Preserved existing trusted posting access',trust_reviewed_at
FROM members WHERE trusted=1;
CREATE INDEX member_trust_status ON members(trusted,trust_reviewed_at);
CREATE INDEX member_trust_history_user ON member_trust_history(user_id,created_at);
