CREATE TABLE following_groups (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
 follows TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX following_groups_user ON following_groups(user_id);
CREATE UNIQUE INDEX following_groups_active ON following_groups(user_id) WHERE active=1;
