-- ============================================
-- Lang Gia quick team roster snapshots
-- Run in Supabase SQL Editor after supabase_setup.sql.
-- ============================================

CREATE TABLE IF NOT EXISTS public.bc_roster_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    source_session_id UUID NOT NULL,
    day TEXT,
    time TEXT,
    label TEXT,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    source_updated_at TIMESTAMPTZ,
    team_layout JSONB DEFAULT '[]'::jsonb,
    teams JSONB DEFAULT '{}'::jsonb,
    team_attack1 JSONB DEFAULT '[]'::jsonb,
    team_attack2 JSONB DEFAULT '[]'::jsonb,
    team_defense JSONB DEFAULT '[]'::jsonb,
    team_forest JSONB DEFAULT '[]'::jsonb,
    waiting_list JSONB DEFAULT '[]'::jsonb,
    team_sizes JSONB DEFAULT '{}'::jsonb,
    team_names JSONB DEFAULT '{}'::jsonb,
    leader_ids JSONB DEFAULT '{}'::jsonb,
    source TEXT DEFAULT 'web',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, source_session_id)
);

ALTER TABLE public.bc_roster_snapshots REPLICA IDENTITY FULL;
ALTER TABLE public.bc_roster_snapshots ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bc_roster_snapshots_guild_captured
    ON public.bc_roster_snapshots(guild_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_bc_roster_snapshots_guild_day_time
    ON public.bc_roster_snapshots(guild_id, day, time);

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bc_roster_snapshots;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.bc_quick_team_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bc_roster_snapshots_updated_at ON public.bc_roster_snapshots;
CREATE TRIGGER bc_roster_snapshots_updated_at
    BEFORE UPDATE ON public.bc_roster_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION public.bc_quick_team_touch_updated_at();

CREATE OR REPLACE FUNCTION public.bc_quick_team_normalize_access_role(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT trim(regexp_replace(
        lower(coalesce(value, '')),
        '[^a-z0-9]+', ' ', 'g'
    ));
$$;

CREATE OR REPLACE FUNCTION public.bc_quick_team_has_manager_access(target_guild_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    allowed BOOLEAN;
BEGIN
    IF to_regprocedure('public.bc_has_manager_access(text)') IS NOT NULL THEN
        EXECUTE 'SELECT public.bc_has_manager_access($1)' INTO allowed USING target_guild_id;
        RETURN COALESCE(allowed, false);
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.bc_users u
        WHERE u.guild_id = target_guild_id
          AND u.discord_id = public.bc_current_discord_id()
          AND u.lang_gia_member IS TRUE
          AND public.bc_quick_team_normalize_access_role(u.position) IN ('bc', 'pbc', 'kc', 'ql', 'quan ly', 'ky cuu')
    );
END;
$$;

DROP POLICY IF EXISTS "Authenticated users can read bc_roster_snapshots" ON public.bc_roster_snapshots;
CREATE POLICY "Authenticated users can read bc_roster_snapshots"
    ON public.bc_roster_snapshots FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Managers can insert bc_roster_snapshots" ON public.bc_roster_snapshots;
CREATE POLICY "Managers can insert bc_roster_snapshots"
    ON public.bc_roster_snapshots FOR INSERT
    TO authenticated
    WITH CHECK (public.bc_quick_team_has_manager_access(guild_id));

DROP POLICY IF EXISTS "Managers can update bc_roster_snapshots" ON public.bc_roster_snapshots;
CREATE POLICY "Managers can update bc_roster_snapshots"
    ON public.bc_roster_snapshots FOR UPDATE
    TO authenticated
    USING (public.bc_quick_team_has_manager_access(guild_id))
    WITH CHECK (public.bc_quick_team_has_manager_access(guild_id));

DROP POLICY IF EXISTS "Service role can do everything on bc_roster_snapshots" ON public.bc_roster_snapshots;
CREATE POLICY "Service role can do everything on bc_roster_snapshots"
    ON public.bc_roster_snapshots FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

GRANT SELECT ON public.bc_roster_snapshots TO authenticated;
GRANT INSERT, UPDATE ON public.bc_roster_snapshots TO authenticated;
GRANT ALL ON public.bc_roster_snapshots TO service_role;
