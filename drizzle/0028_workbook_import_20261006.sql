CREATE TABLE workbook_import_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,filename TEXT NOT NULL,sheet TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ready',created_at TEXT NOT NULL,applied_at TEXT,receipt TEXT,duplicates INTEGER NOT NULL DEFAULT 0,omitted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX workbook_import_history ON workbook_import_jobs(owner_id,created_at);
CREATE TABLE workbook_import_channels(job_id TEXT NOT NULL REFERENCES workbook_import_jobs(id) ON DELETE CASCADE,id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(job_id,id));
CREATE TABLE workbook_import_videos(job_id TEXT NOT NULL REFERENCES workbook_import_jobs(id) ON DELETE CASCADE,id TEXT NOT NULL,channel_id TEXT NOT NULL,title TEXT NOT NULL,published_at TEXT,confidence TEXT NOT NULL,format TEXT NOT NULL,PRIMARY KEY(job_id,id));
CREATE TABLE workbook_import_scopes(job_id TEXT NOT NULL REFERENCES workbook_import_jobs(id) ON DELETE CASCADE,channel_id TEXT NOT NULL,scope TEXT NOT NULL,PRIMARY KEY(job_id,channel_id));
