-- ============================================
-- LANG GIA - Web Bang Chiến - Database Setup
-- Chạy trong Supabase SQL Editor
-- ============================================

-- 1. Bảng phiên bang chiến active
CREATE TABLE IF NOT EXISTS bc_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    day TEXT NOT NULL CHECK (day IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    team_attack1 JSONB DEFAULT '[]',
    team_attack2 JSONB DEFAULT '[]',
    team_defense JSONB DEFAULT '[]',
    team_forest JSONB DEFAULT '[]',
    waiting_list JSONB DEFAULT '[]',
    leader_ids JSONB DEFAULT '{}',
    team_sizes JSONB DEFAULT '{"attack1":10,"attack2":10,"defense":5,"forest":5}',
    team_names JSONB DEFAULT '{}',
    status TEXT DEFAULT 'active',
    time TEXT DEFAULT '19:30',
    note TEXT DEFAULT '',
    locked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, day, time)
);

-- 2. Bảng user mapping (sync từ bot SQLite)
CREATE TABLE IF NOT EXISTS bc_users (
    discord_id TEXT PRIMARY KEY,
    discord_name TEXT,
    game_username TEXT,
    game_uid TEXT,
    position TEXT DEFAULT 'mem',
    sub_role TEXT,
    guild_id TEXT,
    lang_gia_member BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Bảng chiến thuật map (chỉ web dùng)
CREATE TABLE IF NOT EXISTS bc_tactics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    session_id UUID,
    day TEXT NOT NULL,
    markers JSONB DEFAULT '[]',
    drawings JSONB DEFAULT '[]',
    notes TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, session_id)
);

-- 4. Bảng log thay đổi
-- 4. Báº£ng lá»‹ch sá»­ chiáº¿n thuáº­t
CREATE TABLE IF NOT EXISTS bc_tactics_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    session_id UUID,
    day TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('edit', 'battle')),
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    saved_by TEXT,
    roster JSONB,
    markers JSONB NOT NULL,
    result_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_tactics_history_guild_day
    ON bc_tactics_history(guild_id, day, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_tactics_history_guild_session
    ON bc_tactics_history(guild_id, session_id, saved_at DESC);

-- 5. Báº£ng preset chiáº¿n thuáº­t cÃ¡ nhÃ¢n
CREATE TABLE IF NOT EXISTS bc_tactics_presets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    preset_name TEXT NOT NULL,
    markers JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tactics_presets_user
    ON bc_tactics_presets(guild_id, discord_id);

CREATE TABLE IF NOT EXISTS bc_logs (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details JSONB,
    performed_by TEXT,
    source TEXT DEFAULT 'bot' CHECK (source IN ('bot', 'web')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bc_regulars (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    username TEXT,
    day TEXT NOT NULL CHECK (day IN ('sat', 'sun')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, discord_id, day)
);
ALTER TABLE bc_regulars REPLICA IDENTITY FULL;

-- 5. Enable Realtime cho các bảng cần đồng bộ
ALTER PUBLICATION supabase_realtime ADD TABLE bc_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE bc_tactics;
ALTER PUBLICATION supabase_realtime ADD TABLE bc_tactics_history;
ALTER PUBLICATION supabase_realtime ADD TABLE bc_tactics_presets;
ALTER PUBLICATION supabase_realtime ADD TABLE bc_regulars;

-- 6. Bật Row Level Security
ALTER TABLE bc_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_tactics ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_tactics_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_tactics_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_regulars ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.bc_current_discord_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        auth.jwt() -> 'user_metadata' ->> 'provider_id',
        auth.jwt() ->> 'sub'
    );
$$;

CREATE OR REPLACE FUNCTION public.bc_can_write_own_regular(
    target_guild_id TEXT,
    target_discord_id TEXT,
    target_day TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT target_discord_id = public.bc_current_discord_id()
       AND target_day IN ('sat', 'sun')
       AND EXISTS (
            SELECT 1
            FROM public.bc_users u
            WHERE u.guild_id = target_guild_id
              AND u.discord_id = target_discord_id
              AND u.lang_gia_member IS TRUE
              AND lower(coalesce(u.position, '')) NOT IN ('khong co', 'left', 'out')
       );
$$;

-- 7. RLS Policies - Cho phép đọc nếu đã đăng nhập
CREATE POLICY "Authenticated users can read bc_sessions"
    ON bc_sessions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can read bc_users"
    ON bc_users FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can read bc_tactics"
    ON bc_tactics FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can read bc_tactics_history"
    ON bc_tactics_history FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can read bc_tactics_presets"
    ON bc_tactics_presets FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can read bc_logs"
    ON bc_logs FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can read bc_regulars"
    ON bc_regulars FOR SELECT
    TO authenticated
    USING (true);

-- 8. RLS - Cho phép service_role (bot) ghi tất cả
CREATE POLICY "Service role can do everything on bc_sessions"
    ON bc_sessions FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on bc_users"
    ON bc_users FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on bc_tactics"
    ON bc_tactics FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on bc_tactics_history"
    ON bc_tactics_history FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on bc_tactics_presets"
    ON bc_tactics_presets FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on bc_logs"
    ON bc_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on bc_regulars"
    ON bc_regulars FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 9. RLS - Cho phép authenticated users ghi bc_tactics (chiến thuật)
CREATE POLICY "Authenticated users can update bc_tactics"
    ON bc_tactics FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update bc_sessions"
    ON bc_sessions FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can insert bc_tactics"
    ON bc_tactics FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can insert bc_tactics_history"
    ON bc_tactics_history FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can insert bc_tactics_presets"
    ON bc_tactics_presets FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update bc_tactics_presets"
    ON bc_tactics_presets FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can delete bc_tactics_presets"
    ON bc_tactics_presets FOR DELETE
    TO authenticated
    USING (true);

CREATE POLICY "Regular owners can insert bc_regulars"
    ON bc_regulars FOR INSERT
    TO authenticated
    WITH CHECK (public.bc_can_write_own_regular(guild_id, discord_id, day));

CREATE POLICY "Regular owners can update bc_regulars"
    ON bc_regulars FOR UPDATE
    TO authenticated
    USING (public.bc_can_write_own_regular(guild_id, discord_id, day))
    WITH CHECK (public.bc_can_write_own_regular(guild_id, discord_id, day));

CREATE POLICY "Regular owners can delete bc_regulars"
    ON bc_regulars FOR DELETE
    TO authenticated
    USING (public.bc_can_write_own_regular(guild_id, discord_id, day));

ALTER TABLE bc_sessions ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false;
ALTER TABLE bc_sessions ADD COLUMN IF NOT EXISTS team_names JSONB DEFAULT '{}';

-- 10. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bc_sessions_updated_at
    BEFORE UPDATE ON bc_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER bc_users_updated_at
    BEFORE UPDATE ON bc_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER bc_tactics_updated_at
    BEFORE UPDATE ON bc_tactics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER bc_tactics_presets_updated_at
    BEFORE UPDATE ON bc_tactics_presets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ✅ Done! Kiểm tra bằng cách chạy:
-- SELECT * FROM bc_sessions;
-- SELECT * FROM bc_users;
