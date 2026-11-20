CREATE TABLE ranked_profiles (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  rating INTEGER NOT NULL DEFAULT 1000 CHECK(rating >= 0),
  games INTEGER NOT NULL DEFAULT 0 CHECK(games >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK(losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK(draws >= 0),
  updated_at INTEGER NOT NULL,
  CHECK(games = wins + losses + draws)
);
--> statement-breakpoint
CREATE INDEX ranked_leaderboard ON ranked_profiles(rating DESC, wins DESC, games, player_id);
--> statement-breakpoint
CREATE TABLE ranked_queue (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('waiting','matched','cancelled','expired')),
  team_json TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  match_id TEXT REFERENCES ranked_matches(id),
  UNIQUE(player_id,request_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ranked_one_waiting ON ranked_queue(player_id) WHERE state='waiting';
--> statement-breakpoint
CREATE INDEX ranked_queue_candidates ON ranked_queue(state,rules_version,seen_at,joined_at);
--> statement-breakpoint
CREATE TABLE ranked_matches (
  id TEXT PRIMARY KEY,
  queue0_id TEXT NOT NULL UNIQUE REFERENCES ranked_queue(id),
  queue1_id TEXT NOT NULL UNIQUE REFERENCES ranked_queue(id),
  player0_id TEXT NOT NULL REFERENCES players(id),
  player1_id TEXT NOT NULL REFERENCES players(id),
  rules_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'battle' CHECK(state IN ('battle','result')),
  battle_json TEXT NOT NULL,
  round INTEGER NOT NULL CHECK(round >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  seen0_at INTEGER NOT NULL,
  seen1_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  rating0_before INTEGER NOT NULL,
  rating1_before INTEGER NOT NULL,
  rating0_after INTEGER,
  rating1_after INTEGER,
  delta0 INTEGER,
  delta1 INTEGER,
  winner TEXT CHECK(winner IN ('0','1','draw','void')),
  reason TEXT,
  settlement_token TEXT UNIQUE,
  settled_at INTEGER,
  acked0_at INTEGER,
  acked1_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(player0_id <> player1_id),
  CHECK(queue0_id <> queue1_id),
  CHECK((state='battle' AND settled_at IS NULL AND settlement_token IS NULL) OR
        (state='result' AND settled_at IS NOT NULL AND settlement_token IS NOT NULL AND winner IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX ranked_match_player0 ON ranked_matches(player0_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX ranked_match_player1 ON ranked_matches(player1_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX ranked_match_timeouts ON ranked_matches(state,deadline_at,seen0_at,seen1_at);
--> statement-breakpoint
CREATE TABLE ranked_members (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  queue_id TEXT UNIQUE REFERENCES ranked_queue(id),
  match_id TEXT REFERENCES ranked_matches(id),
  side INTEGER CHECK(side IN (0,1)),
  UNIQUE(match_id,side),
  CHECK((queue_id IS NOT NULL AND match_id IS NULL AND side IS NULL) OR
        (queue_id IS NULL AND match_id IS NOT NULL AND side IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE ranked_orders (
  match_id TEXT NOT NULL REFERENCES ranked_matches(id),
  round INTEGER NOT NULL,
  side INTEGER NOT NULL CHECK(side IN (0,1)),
  request_id TEXT NOT NULL,
  orders_json TEXT NOT NULL,
  write_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(match_id,round,side),
  UNIQUE(match_id,side,request_id)
);
