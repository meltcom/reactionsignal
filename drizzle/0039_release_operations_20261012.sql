CREATE TABLE account_restrictions (
 user_id TEXT PRIMARY KEY REFERENCES members(id),
 kind TEXT NOT NULL CHECK(kind IN ('suspended','banned')),
 reason TEXT NOT NULL, expires_at TEXT, moderator_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE moderation_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_kind TEXT NOT NULL,
 target_id TEXT NOT NULL, reason TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX release_audit_target ON moderation_audit(target_kind,target_id,created_at DESC,id);
CREATE INDEX release_audit_date ON moderation_audit(created_at DESC,id);
CREATE TABLE case_assignments (
 kind TEXT NOT NULL CHECK(kind IN ('abuse','contribution','contact','reactor')),
 target_id TEXT NOT NULL, assignee_id TEXT NOT NULL, assigned_by TEXT NOT NULL, assigned_at TEXT NOT NULL,
 PRIMARY KEY(kind,target_id)
);
CREATE INDEX release_case_assignee ON case_assignments(assignee_id,kind);
CREATE TABLE operational_events (
 id TEXT PRIMARY KEY, code TEXT NOT NULL, severity TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX release_events_date ON operational_events(created_at,code);
CREATE TABLE operational_alerts (
 code TEXT PRIMARY KEY, last_attempt_at TEXT NOT NULL, delivered_at TEXT, error TEXT
);

CREATE INDEX release_members_email ON members(email);
INSERT OR IGNORE INTO state(key,value) VALUES('aggregate-revision','0');
CREATE TRIGGER release_ratings_insert AFTER INSERT ON ratings BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_ratings_update AFTER UPDATE ON ratings BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_ratings_delete AFTER DELETE ON ratings BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_reactor_ratings_insert AFTER INSERT ON reactor_ratings BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_reactor_ratings_update AFTER UPDATE ON reactor_ratings BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_reactor_ratings_delete AFTER DELETE ON reactor_ratings BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_points_insert AFTER INSERT ON points BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_points_update AFTER UPDATE ON points BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_points_delete AFTER DELETE ON points BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_contributions_insert AFTER INSERT ON contributions BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_contributions_update AFTER UPDATE ON contributions BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_contributions_delete AFTER DELETE ON contributions BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_reputation_events_insert AFTER INSERT ON reputation_events BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_reputation_events_update AFTER UPDATE ON reputation_events BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_reputation_events_delete AFTER DELETE ON reputation_events BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_members_insert AFTER INSERT ON members BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_members_update AFTER UPDATE ON members BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
CREATE TRIGGER release_members_delete AFTER DELETE ON members BEGIN UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='aggregate-revision'; END;
