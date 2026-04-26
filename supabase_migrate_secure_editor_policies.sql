-- ============================================
-- Migration: tighten web write policies
-- Authenticated users can still read, but writes are limited to
-- guild staff or the leader of the active session being edited.
-- ============================================

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

CREATE OR REPLACE FUNCTION public.bc_is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.bc_users u
        WHERE u.discord_id = public.bc_current_discord_id()
          AND u.lang_gia_member IS TRUE
          AND (
              lower(coalesce(u.position, '')) IN ('bc', 'pbc', 'kc', 'ql', 'quan ly', 'quản lý', 'ky cuu', 'kỳ cựu')
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.bc_as_jsonb_array(value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    parsed JSONB;
BEGIN
    IF value IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;
    IF jsonb_typeof(value) = 'array' THEN
        RETURN value;
    END IF;
    IF jsonb_typeof(value) = 'string' THEN
        BEGIN
            parsed := (value #>> '{}')::jsonb;
            IF jsonb_typeof(parsed) = 'array' THEN
                RETURN parsed;
            END IF;
        EXCEPTION WHEN others THEN
            RETURN '[]'::jsonb;
        END;
    END IF;
    RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_as_jsonb_object(value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    parsed JSONB;
BEGIN
    IF value IS NULL THEN
        RETURN '{}'::jsonb;
    END IF;
    IF jsonb_typeof(value) = 'object' THEN
        RETURN value;
    END IF;
    IF jsonb_typeof(value) = 'string' THEN
        BEGIN
            parsed := (value #>> '{}')::jsonb;
            IF jsonb_typeof(parsed) = 'object' THEN
                RETURN parsed;
            END IF;
        EXCEPTION WHEN others THEN
            RETURN '{}'::jsonb;
        END;
    END IF;
    RETURN '{}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_is_session_leader(
    target_guild_id TEXT,
    target_session_id UUID,
    target_day TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH current_user_id AS (
        SELECT public.bc_current_discord_id() AS discord_id
    )
    SELECT public.bc_is_staff()
        OR EXISTS (
            SELECT 1
            FROM public.bc_sessions s, current_user_id c
            WHERE c.discord_id IS NOT NULL
              AND s.guild_id = target_guild_id
              AND (
                  (target_session_id IS NOT NULL AND s.id = target_session_id)
                  OR (target_session_id IS NULL AND s.day = target_day)
              )
              AND (
                  public.bc_as_jsonb_object(s.leader_ids) ->> 'creator_id' = c.discord_id
                  OR public.bc_as_jsonb_object(s.leader_ids) ->> 'commander' = c.discord_id
                  OR public.bc_as_jsonb_object(s.leader_ids) ->> 'team1' = c.discord_id
                  OR public.bc_as_jsonb_object(s.leader_ids) ->> 'team2' = c.discord_id
                  OR public.bc_as_jsonb_object(s.leader_ids) ->> 'team3' = c.discord_id
                  OR public.bc_as_jsonb_object(s.leader_ids) ->> 'team4' = c.discord_id
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(
                          public.bc_as_jsonb_array(s.team_attack1)
                          || public.bc_as_jsonb_array(s.team_attack2)
                          || public.bc_as_jsonb_array(s.team_defense)
                          || public.bc_as_jsonb_array(s.team_forest)
                          || public.bc_as_jsonb_array(s.waiting_list)
                      ) member
                      WHERE member ->> 'id' = c.discord_id
                        AND (
                            coalesce(member ->> 'isLeader', 'false')::boolean IS TRUE
                            OR coalesce(member ->> 'ld', 'false')::boolean IS TRUE
                            OR coalesce(member ->> 'isTeamLeader', 'false')::boolean IS TRUE
                        )
                  )
              )
        );
$$;

CREATE OR REPLACE FUNCTION public.bc_can_edit_tactics(
    target_guild_id TEXT,
    target_session_id UUID,
    target_day TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.bc_is_session_leader(target_guild_id, target_session_id, target_day);
$$;

DROP POLICY IF EXISTS "Authenticated users can update bc_sessions" ON bc_sessions;
DROP POLICY IF EXISTS "Authenticated users can update bc_tactics" ON bc_tactics;
DROP POLICY IF EXISTS "Authenticated users can insert bc_tactics" ON bc_tactics;
DROP POLICY IF EXISTS "Authenticated users can insert bc_tactics_history" ON bc_tactics_history;
DROP POLICY IF EXISTS "Authenticated users can insert bc_tactics_presets" ON bc_tactics_presets;
DROP POLICY IF EXISTS "Authenticated users can update bc_tactics_presets" ON bc_tactics_presets;
DROP POLICY IF EXISTS "Authenticated users can delete bc_tactics_presets" ON bc_tactics_presets;
DROP POLICY IF EXISTS "Staff can insert bc_sessions" ON bc_sessions;
DROP POLICY IF EXISTS "Staff and session leaders can update bc_sessions" ON bc_sessions;
DROP POLICY IF EXISTS "Staff and session leaders can insert bc_tactics" ON bc_tactics;
DROP POLICY IF EXISTS "Staff and session leaders can update bc_tactics" ON bc_tactics;
DROP POLICY IF EXISTS "Staff and session leaders can insert bc_tactics_history" ON bc_tactics_history;
DROP POLICY IF EXISTS "Preset owners can insert bc_tactics_presets" ON bc_tactics_presets;
DROP POLICY IF EXISTS "Preset owners can update bc_tactics_presets" ON bc_tactics_presets;
DROP POLICY IF EXISTS "Preset owners can delete bc_tactics_presets" ON bc_tactics_presets;

CREATE POLICY "Staff can insert bc_sessions"
    ON bc_sessions FOR INSERT
    TO authenticated
    WITH CHECK (public.bc_is_staff());

CREATE POLICY "Staff and session leaders can update bc_sessions"
    ON bc_sessions FOR UPDATE
    TO authenticated
    USING (public.bc_is_session_leader(guild_id, id, day))
    WITH CHECK (public.bc_is_session_leader(guild_id, id, day));

CREATE POLICY "Staff and session leaders can insert bc_tactics"
    ON bc_tactics FOR INSERT
    TO authenticated
    WITH CHECK (public.bc_can_edit_tactics(guild_id, session_id, day));

CREATE POLICY "Staff and session leaders can update bc_tactics"
    ON bc_tactics FOR UPDATE
    TO authenticated
    USING (public.bc_can_edit_tactics(guild_id, session_id, day))
    WITH CHECK (public.bc_can_edit_tactics(guild_id, session_id, day));

CREATE POLICY "Staff and session leaders can insert bc_tactics_history"
    ON bc_tactics_history FOR INSERT
    TO authenticated
    WITH CHECK (public.bc_can_edit_tactics(guild_id, session_id, day));

CREATE POLICY "Preset owners can insert bc_tactics_presets"
    ON bc_tactics_presets FOR INSERT
    TO authenticated
    WITH CHECK (discord_id = public.bc_current_discord_id());

CREATE POLICY "Preset owners can update bc_tactics_presets"
    ON bc_tactics_presets FOR UPDATE
    TO authenticated
    USING (discord_id = public.bc_current_discord_id())
    WITH CHECK (discord_id = public.bc_current_discord_id());

CREATE POLICY "Preset owners can delete bc_tactics_presets"
    ON bc_tactics_presets FOR DELETE
    TO authenticated
    USING (discord_id = public.bc_current_discord_id());
