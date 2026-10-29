-- Additive measurement only: existing decisions, cursors and catalog rows are unchanged.
ALTER TABLE discovery_observations ADD COLUMN strategy_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE discovery_observations ADD COLUMN search_page_id TEXT;
CREATE TABLE discovery_search_pages(
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, performer_id TEXT NOT NULL,
 strategy_version TEXT NOT NULL, settings_json TEXT NOT NULL, query TEXT NOT NULL,
 window_start TEXT, window_end TEXT NOT NULL, page_depth INTEGER NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL DEFAULT 'started',
 results INTEGER NOT NULL DEFAULT 0, new_videos INTEGER NOT NULL DEFAULT 0,
 new_reactors INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX discovery_pages_date ON discovery_search_pages(started_at);
CREATE TABLE discovery_search_attempts(
 id TEXT PRIMARY KEY, page_id TEXT NOT NULL, attempted_at TEXT NOT NULL,
 quota_day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'started', http_status INTEGER,
 duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX discovery_attempts_date ON discovery_search_attempts(attempted_at);
CREATE INDEX discovery_attempts_page ON discovery_search_attempts(page_id);
CREATE TABLE discovery_search_results(
 page_id TEXT NOT NULL, video_id TEXT NOT NULL, channel_id TEXT,
 match_status TEXT, disposition TEXT NOT NULL, is_new INTEGER NOT NULL DEFAULT 0,
 new_reactor INTEGER NOT NULL DEFAULT 0, delay_seconds INTEGER,
 PRIMARY KEY(page_id,video_id)
);
CREATE TABLE discovery_health_samples(
 sampled_at TEXT PRIMARY KEY, strategy_version TEXT NOT NULL, settings_json TEXT NOT NULL,
 eligible INTEGER NOT NULL, checked INTEGER NOT NULL, rss_checked INTEGER NOT NULL,
 rss_errors INTEGER NOT NULL, run_status TEXT NOT NULL, duration_ms INTEGER NOT NULL,
 api_calls INTEGER NOT NULL, rows_read INTEGER NOT NULL, rows_written INTEGER NOT NULL
);
CREATE INDEX discovery_health_date ON discovery_health_samples(sampled_at);
