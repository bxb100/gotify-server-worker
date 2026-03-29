INSERT INTO plugin_states (token, enabled, last_cleanup_at, last_deleted_count, last_error)
VALUES ('client-token-cleanup', 0, NULL, 0, NULL)
ON CONFLICT(token) DO NOTHING;

INSERT INTO plugin_configs (token, config)
VALUES (
  'client-token-cleanup',
  '# Delete client tokens whose name matches this regex and whose last login is older than the configured days.
clientNameRegex: ^$
lastLoginOlderThanDays: 7
'
)
ON CONFLICT(token) DO NOTHING;
