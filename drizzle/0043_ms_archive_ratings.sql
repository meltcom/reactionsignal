-- Facebook archive videos live in state, separately from reaction-feed videos.
CREATE TABLE ms_archive_ratings (
 user_id TEXT NOT NULL REFERENCES members(id),
 video_id TEXT NOT NULL,
 score INTEGER NOT NULL CHECK(typeof(score)='integer' AND score BETWEEN 1 AND 5),
 created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,video_id)
);
CREATE INDEX ms_archive_ratings_video ON ms_archive_ratings(video_id);
