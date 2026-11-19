-- Extend the deployed two-seat schema without rewriting registrations or gifts.
CREATE TABLE third_admin_owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  player_id TEXT NOT NULL UNIQUE REFERENCES players(id),
  claimed_at INTEGER NOT NULL
);
--> statement-breakpoint
DROP VIEW admin_members;
--> statement-breakpoint
CREATE VIEW admin_members AS
  SELECT 1 AS singleton, player_id, claimed_at FROM admin_owner
  UNION ALL
  SELECT 2 AS singleton, player_id, claimed_at FROM sub_admin_owner
  UNION ALL
  SELECT 3 AS singleton, player_id, claimed_at FROM third_admin_owner;
--> statement-breakpoint
CREATE TRIGGER admin_owner_third_distinct_insert
BEFORE INSERT ON admin_owner
WHEN EXISTS (SELECT 1 FROM third_admin_owner WHERE player_id = NEW.player_id)
BEGIN
  SELECT RAISE(ABORT, 'administrator already occupies another seat');
END;
--> statement-breakpoint
CREATE TRIGGER admin_owner_third_distinct_update
BEFORE UPDATE OF player_id ON admin_owner
WHEN EXISTS (SELECT 1 FROM third_admin_owner WHERE player_id = NEW.player_id)
BEGIN
  SELECT RAISE(ABORT, 'administrator already occupies another seat');
END;
--> statement-breakpoint
CREATE TRIGGER sub_admin_owner_third_distinct_insert
BEFORE INSERT ON sub_admin_owner
WHEN EXISTS (SELECT 1 FROM third_admin_owner WHERE player_id = NEW.player_id)
BEGIN
  SELECT RAISE(ABORT, 'administrator already occupies another seat');
END;
--> statement-breakpoint
CREATE TRIGGER sub_admin_owner_third_distinct_update
BEFORE UPDATE OF player_id ON sub_admin_owner
WHEN EXISTS (SELECT 1 FROM third_admin_owner WHERE player_id = NEW.player_id)
BEGIN
  SELECT RAISE(ABORT, 'administrator already occupies another seat');
END;
--> statement-breakpoint
CREATE TRIGGER third_admin_owner_distinct_insert
BEFORE INSERT ON third_admin_owner
WHEN EXISTS (SELECT 1 FROM admin_owner WHERE player_id = NEW.player_id)
  OR EXISTS (SELECT 1 FROM sub_admin_owner WHERE player_id = NEW.player_id)
BEGIN
  SELECT RAISE(ABORT, 'administrator already occupies another seat');
END;
--> statement-breakpoint
CREATE TRIGGER third_admin_owner_distinct_update
BEFORE UPDATE OF player_id ON third_admin_owner
WHEN EXISTS (SELECT 1 FROM admin_owner WHERE player_id = NEW.player_id)
  OR EXISTS (SELECT 1 FROM sub_admin_owner WHERE player_id = NEW.player_id)
BEGIN
  SELECT RAISE(ABORT, 'administrator already occupies another seat');
END;
