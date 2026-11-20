-- Existing rooms keep their original hall and all saved furniture.
-- The selected operator template survives a later role change.
ALTER TABLE world_rooms ADD COLUMN template_id TEXT NOT NULL DEFAULT 'hall'
  CHECK (template_id IN ('hall', 'sanctum', 'wings'));
