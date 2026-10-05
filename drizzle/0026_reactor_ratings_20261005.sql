CREATE TABLE reactor_ratings(user_id TEXT NOT NULL,channel_id TEXT NOT NULL REFERENCES channels(id),score INTEGER NOT NULL CHECK(typeof(score)='integer' AND score BETWEEN 1 AND 100),updated_at TEXT NOT NULL,PRIMARY KEY(user_id,channel_id));
CREATE INDEX journey_reactor_ratings_channel ON reactor_ratings(channel_id,score);
