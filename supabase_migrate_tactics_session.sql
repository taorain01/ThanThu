-- ============================================
-- Migration: split live tactics by session_id
-- ============================================

-- 1. Add session_id to live tactics and history
ALTER TABLE bc_tactics ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE bc_tactics_history ADD COLUMN IF NOT EXISTS session_id UUID;

-- 2. Backfill existing live tactics from matching active session by guild/day
UPDATE bc_tactics AS t
SET session_id = s.id
FROM bc_sessions AS s
WHERE t.session_id IS NULL
  AND s.guild_id = t.guild_id
  AND s.day = t.day;

-- 3. Drop old day unique so different sessions can coexist over time
ALTER TABLE bc_tactics DROP CONSTRAINT IF EXISTS bc_tactics_guild_id_day_key;

-- 4. Add new unique index by session_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_tactics_guild_session_unique
    ON bc_tactics(guild_id, session_id)
    WHERE session_id IS NOT NULL;

-- 5. Add index for history queries by session
CREATE INDEX IF NOT EXISTS idx_tactics_history_guild_session
    ON bc_tactics_history(guild_id, session_id, saved_at DESC);

-- 6. Quick verification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('bc_tactics', 'bc_tactics_history')
ORDER BY table_name, ordinal_position;
