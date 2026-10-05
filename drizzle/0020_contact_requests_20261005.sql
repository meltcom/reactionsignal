CREATE TABLE contact_tickets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES members(id),subject TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX journey_contact_owner ON contact_tickets(user_id,updated_at DESC);
CREATE INDEX journey_contact_updated ON contact_tickets(updated_at DESC);
CREATE TABLE contact_messages(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES contact_tickets(id),user_id TEXT NOT NULL,moderator INTEGER NOT NULL DEFAULT 0,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX journey_contact_thread ON contact_messages(ticket_id,created_at,id);
CREATE INDEX journey_contact_sender ON contact_messages(user_id,created_at);
