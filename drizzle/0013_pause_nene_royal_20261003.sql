-- Pause Nene Royal discovery; retain catalog, chats, and moderation decisions.
UPDATE performers
SET discovery_enabled = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'nene-royal';
