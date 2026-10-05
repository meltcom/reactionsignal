CREATE TABLE reactor_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('add','remove')),channel_id TEXT NOT NULL,channel_name TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,review_note TEXT,reviewed_at TEXT,reviewed_by TEXT);
CREATE INDEX journey_reactor_requests_queue ON reactor_requests(status,created_at,id);
CREATE INDEX journey_reactor_requests_user ON reactor_requests(user_id,created_at DESC);
CREATE UNIQUE INDEX journey_reactor_requests_pending ON reactor_requests(user_id,kind,channel_id) WHERE status='pending';
