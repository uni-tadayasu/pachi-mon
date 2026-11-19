ALTER TABLE world_presence ADD COLUMN input_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE kasai_live_sessions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL REFERENCES players(id),
  kasai_id TEXT NOT NULL REFERENCES players(id),
  room_id TEXT NOT NULL REFERENCES world_rooms(owner_id),
  state TEXT NOT NULL DEFAULT 'staging' CHECK(state IN ('staging','permission','battle','result','closed')),
  challenger_return_json TEXT NOT NULL,
  kasai_return_json TEXT NOT NULL,
  challenger_party_json TEXT NOT NULL,
  kasai_party_json TEXT,
  challenger_avatar TEXT NOT NULL DEFAULT 'male',
  challenger_arrived INTEGER NOT NULL DEFAULT 0,
  kasai_arrived INTEGER NOT NULL DEFAULT 0,
  challenger_seen INTEGER NOT NULL,
  kasai_seen INTEGER NOT NULL,
  challenger_ack_at INTEGER,
  kasai_ack_at INTEGER,
  deadline_at INTEGER NOT NULL,
  battle_json TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  seed INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  close_token TEXT,
  UNIQUE(challenger_id,request_id),
  CHECK(challenger_id<>kasai_id)
);
--> statement-breakpoint
CREATE INDEX kasai_live_challenger ON kasai_live_sessions(challenger_id,created_at);
--> statement-breakpoint
CREATE INDEX kasai_live_kasai ON kasai_live_sessions(kasai_id,created_at);
--> statement-breakpoint
CREATE INDEX kasai_live_active ON kasai_live_sessions(state,updated_at);
--> statement-breakpoint
CREATE TABLE kasai_live_members (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  session_id TEXT NOT NULL REFERENCES kasai_live_sessions(id),
  side INTEGER NOT NULL CHECK(side IN (0,1)),
  UNIQUE(session_id,side)
);
--> statement-breakpoint
CREATE TABLE kasai_live_orders (
  session_id TEXT NOT NULL REFERENCES kasai_live_sessions(id),
  side INTEGER NOT NULL CHECK(side IN (0,1)),
  round INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  orders_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(session_id,round,side),
  UNIQUE(session_id,side,request_id)
);
--> statement-breakpoint
CREATE TABLE kasai_rewards_live (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  receipt_id TEXT NOT NULL UNIQUE,
  challenge_id TEXT UNIQUE REFERENCES kasai_challenges(id),
  live_session_id TEXT UNIQUE REFERENCES kasai_live_sessions(id),
  gender TEXT NOT NULL CHECK (gender IN ('male','female')),
  created_at INTEGER NOT NULL,
  acked_at INTEGER,
  CHECK ((challenge_id IS NOT NULL AND live_session_id IS NULL) OR (challenge_id IS NULL AND live_session_id IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO kasai_rewards_live (player_id,receipt_id,challenge_id,gender,created_at,acked_at)
SELECT player_id,receipt_id,challenge_id,gender,created_at,acked_at FROM kasai_rewards;
--> statement-breakpoint
DROP TABLE kasai_rewards;
--> statement-breakpoint
ALTER TABLE kasai_rewards_live RENAME TO kasai_rewards;
