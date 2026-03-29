CREATE TABLE IF NOT EXISTS plugin_configs (
  token TEXT PRIMARY KEY,
  config TEXT NOT NULL
);

INSERT INTO plugin_configs (token, config)
VALUES (
  'message-auto-delete-token',
  '# Delete messages older than this many days.
retentionDays: 15
'
)
ON CONFLICT(token) DO NOTHING;
