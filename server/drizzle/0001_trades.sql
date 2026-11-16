CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES players(id),
  guest_id TEXT REFERENCES players(id),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','committed','cancelled','expired')),
  revision INTEGER NOT NULL DEFAULT 0,
  host_offer TEXT,
  guest_offer TEXT,
  host_confirm INTEGER,
  guest_confirm INTEGER,
  host_ack INTEGER NOT NULL DEFAULT 0,
  guest_ack INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  committed_at INTEGER,
  UNIQUE(host_id, request_id),
  CHECK (guest_id IS NULL OR guest_id <> host_id)
);
--> statement-breakpoint
CREATE TABLE trade_active (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  trade_id TEXT NOT NULL REFERENCES trades(id)
);
--> statement-breakpoint
CREATE INDEX trades_expiry ON trades(state, expires_at);
