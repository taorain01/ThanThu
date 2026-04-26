-- ============================================
-- Migration: add custom team names to sessions
-- ============================================

ALTER TABLE bc_sessions
    ADD COLUMN IF NOT EXISTS team_names JSONB DEFAULT '{}';

UPDATE bc_sessions
SET team_names = '{}'
WHERE team_names IS NULL;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'bc_sessions'
  AND column_name = 'team_names';
