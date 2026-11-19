CREATE TABLE world_rooms (
  owner_id TEXT PRIMARY KEY REFERENCES players(id),
  map_id TEXT NOT NULL,
  entrance_x INTEGER NOT NULL,
  entrance_y INTEGER NOT NULL,
  facing TEXT NOT NULL CHECK (facing IN ('up','right','down','left')),
  name TEXT NOT NULL,
  decorations_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(map_id, entrance_x, entrance_y)
);
--> statement-breakpoint
CREATE INDEX world_rooms_map ON world_rooms(map_id);
--> statement-breakpoint
CREATE TABLE kasai_challenges (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  request_id TEXT NOT NULL,
  room_owner_id TEXT NOT NULL REFERENCES world_rooms(owner_id),
  rules_version TEXT NOT NULL,
  party_json TEXT NOT NULL,
  seed INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','won','lost','cancelled','expired')),
  result_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(player_id, request_id)
);
--> statement-breakpoint
CREATE INDEX kasai_challenges_player ON kasai_challenges(player_id, created_at);
--> statement-breakpoint
CREATE INDEX kasai_challenges_expiry ON kasai_challenges(expires_at);
--> statement-breakpoint
CREATE TABLE kasai_rewards (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  receipt_id TEXT NOT NULL UNIQUE,
  challenge_id TEXT NOT NULL UNIQUE REFERENCES kasai_challenges(id),
  gender TEXT NOT NULL CHECK (gender IN ('male','female')),
  created_at INTEGER NOT NULL,
  acked_at INTEGER
);
