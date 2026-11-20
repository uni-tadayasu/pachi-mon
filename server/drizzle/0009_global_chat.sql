-- Shared across maps. Deletion leaves a tombstone so all clients converge;
-- no scheduled or read-time retention removes messages automatically.
CREATE TABLE world_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL REFERENCES players(id),
  client_id TEXT NOT NULL CHECK (length(client_id) = 36),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT REFERENCES players(id),
  UNIQUE (player_id, client_id),
  CHECK ((deleted_at IS NULL AND deleted_by IS NULL) OR
         (deleted_at IS NOT NULL AND deleted_by IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX world_chat_author_time ON world_chat_messages(player_id, created_at);
--> statement-breakpoint
CREATE INDEX world_chat_unread ON world_chat_messages(id, player_id) WHERE deleted_at IS NULL;
