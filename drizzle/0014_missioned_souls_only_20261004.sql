UPDATE performers SET status='draft', discovery_enabled=0, chat_enabled=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id<>'missioned-souls';
