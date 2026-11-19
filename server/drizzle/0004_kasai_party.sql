CREATE TABLE kasai_parties (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  party_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE kasai_challenges ADD COLUMN opponents_json TEXT;
