ALTER TABLE videos ADD COLUMN format_locked INTEGER NOT NULL DEFAULT 0;
UPDATE videos SET format_locked=1 WHERE format='SHORT';
