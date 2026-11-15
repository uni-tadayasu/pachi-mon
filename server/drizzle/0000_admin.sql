CREATE TABLE players (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE admin_owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  player_id TEXT NOT NULL UNIQUE REFERENCES players(id),
  claimed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE futo_config (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  config_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE grant_batches (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES players(id),
  target TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  config_json TEXT NOT NULL,
  max_player_row INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE grants (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id TEXT NOT NULL UNIQUE,
  batch_id TEXT NOT NULL REFERENCES grant_batches(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (batch_id, player_id)
);
--> statement-breakpoint
CREATE INDEX grants_player_cursor ON grants(player_id, row_id);
--> statement-breakpoint
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
