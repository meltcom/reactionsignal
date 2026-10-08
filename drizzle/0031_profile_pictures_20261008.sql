ALTER TABLE members ADD COLUMN profile_picture TEXT;
CREATE TABLE profile_pictures (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES members(id), data TEXT NOT NULL);
