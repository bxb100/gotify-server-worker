CREATE TABLE IF NOT EXISTS plugin_states (
  token TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_cleanup_at TEXT,
  last_deleted_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

INSERT INTO plugin_states (token, enabled, last_cleanup_at, last_deleted_count, last_error)
VALUES ('message-auto-delete-token', 0, NULL, 0, NULL)
ON CONFLICT(token) DO NOTHING;
