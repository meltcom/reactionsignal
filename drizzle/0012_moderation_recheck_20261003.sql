CREATE TABLE review_previews (
 performer_id TEXT NOT NULL,
 video_id TEXT NOT NULL,
 outcome TEXT NOT NULL,
 reason TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 original_source TEXT NOT NULL,
 original_title TEXT NOT NULL,
 original_format TEXT NOT NULL,
 channel_id TEXT NOT NULL,
 aliases TEXT NOT NULL,
 review_mode TEXT NOT NULL,
 PRIMARY KEY(performer_id,video_id)
);
CREATE INDEX rs_review_preview_outcome ON review_previews(outcome,checked_at DESC);
