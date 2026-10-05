CREATE TABLE hidden_reactors(user_id TEXT NOT NULL,channel_id TEXT NOT NULL REFERENCES channels(id),created_at TEXT NOT NULL,PRIMARY KEY(user_id,channel_id));
