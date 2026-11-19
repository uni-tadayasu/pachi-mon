CREATE TABLE world_presence (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  map_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  facing TEXT NOT NULL CHECK (facing IN ('down','left','right','up')),
  avatar TEXT NOT NULL CHECK (avatar IN ('male','female')),
  status TEXT NOT NULL CHECK (status IN ('idle','busy')),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX world_presence_map ON world_presence(map_id, updated_at);
--> statement-breakpoint
CREATE INDEX world_presence_expiry ON world_presence(updated_at);
--> statement-breakpoint
CREATE TABLE world_invitations (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES players(id),
  target_id TEXT NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL CHECK (kind IN ('battle','trade')),
  room_code TEXT NOT NULL,
  map_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','declined','cancelled','expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(sender_id, request_id),
  CHECK (sender_id <> target_id)
);
--> statement-breakpoint
CREATE INDEX world_invitations_sender ON world_invitations(sender_id, updated_at);
--> statement-breakpoint
CREATE INDEX world_invitations_target ON world_invitations(target_id, updated_at);
--> statement-breakpoint
CREATE INDEX world_invitations_expiry ON world_invitations(expires_at);
--> statement-breakpoint
ALTER TABLE trades ADD COLUMN world_guest_id TEXT REFERENCES players(id);
