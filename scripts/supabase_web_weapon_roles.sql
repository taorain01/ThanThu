-- Run once in Supabase SQL Editor.
-- Adds two web-only weapon icon slots for Bang Chien members.

ALTER TABLE public.bc_users
ADD COLUMN IF NOT EXISTS web_weapon_roles jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.bc_web_weapon_normalize_text(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    v_text text := lower(coalesce(p_value, ''));
BEGIN
    v_text := regexp_replace(v_text, U&'[\00E0\00E1\1EA1\1EA3\00E3\00E2\1EA7\1EA5\1EAD\1EA9\1EAB\0103\1EB1\1EAF\1EB7\1EB3\1EB5]', 'a', 'gi');
    v_text := regexp_replace(v_text, U&'[\00E8\00E9\1EB9\1EBB\1EBD\00EA\1EC1\1EBF\1EC7\1EC3\1EC5]', 'e', 'gi');
    v_text := regexp_replace(v_text, U&'[\00EC\00ED\1ECB\1EC9\0129]', 'i', 'gi');
    v_text := regexp_replace(v_text, U&'[\00F2\00F3\1ECD\1ECF\00F5\00F4\1ED3\1ED1\1ED9\1ED5\1ED7\01A1\1EDD\1EDB\1EE3\1EDF\1EE1]', 'o', 'gi');
    v_text := regexp_replace(v_text, U&'[\00F9\00FA\1EE5\1EE7\0169\01B0\1EEB\1EE9\1EF1\1EED\1EEF]', 'u', 'gi');
    v_text := regexp_replace(v_text, U&'[\1EF3\00FD\1EF5\1EF7\1EF9]', 'y', 'gi');
    v_text := regexp_replace(v_text, U&'[\0111]', 'd', 'gi');
    RETURN btrim(regexp_replace(v_text, '[^a-z0-9]+', ' ', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_web_weapon_jsonb_value(p_value jsonb, p_fallback jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
    IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
        RETURN p_fallback;
    END IF;

    IF jsonb_typeof(p_value) = 'string' THEN
        IF NULLIF(p_value #>> '{}', '') IS NULL THEN
            RETURN p_fallback;
        END IF;
        RETURN (p_value #>> '{}')::jsonb;
    END IF;

    RETURN p_value;
EXCEPTION WHEN others THEN
    RETURN p_fallback;
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_web_weapon_member_is_leader(
    p_member jsonb,
    p_discord_id text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT (
        p_member->>'id' = p_discord_id
        OR p_member->>'discord_id' = p_discord_id
        OR p_member->>'discordId' = p_discord_id
    ) AND (
        lower(coalesce(p_member->>'isLeader', 'false')) IN ('true', '1', 'yes')
        OR lower(coalesce(p_member->>'is_leader', 'false')) IN ('true', '1', 'yes')
        OR lower(coalesce(p_member->>'ld', 'false')) IN ('true', '1', 'yes')
        OR lower(coalesce(p_member->>'isTeamLeader', 'false')) IN ('true', '1', 'yes')
        OR lower(coalesce(p_member->>'is_team_leader', 'false')) IN ('true', '1', 'yes')
    );
$$;

CREATE OR REPLACE FUNCTION public.bc_manager_update_web_weapon_roles(
    p_guild_id text,
    p_discord_id text,
    p_web_weapon_roles jsonb
)
RETURNS public.bc_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_auth_id uuid := auth.uid();
    v_actor_discord_id text;
    v_actor public.bc_users%ROWTYPE;
    v_actor_found boolean := false;
    v_has_web_access boolean := false;
    v_actor_position text;
    v_result public.bc_users%ROWTYPE;
    v_roles jsonb;
    v_is_manager boolean := false;
    v_is_session_leader boolean := false;
    v_is_self_update boolean := false;
BEGIN
    IF v_auth_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT raw_user_meta_data->>'provider_id'
    INTO v_actor_discord_id
    FROM auth.users
    WHERE id = v_auth_id;

    IF NULLIF(v_actor_discord_id, '') IS NULL THEN
        RAISE EXCEPTION 'Discord identity not found';
    END IF;

    v_has_web_access := v_actor_discord_id = ANY (ARRAY['403644798667325440', '395151484179841024']);

    SELECT *
    INTO v_actor
    FROM public.bc_users
    WHERE guild_id = p_guild_id
      AND discord_id = v_actor_discord_id
      AND lang_gia_member IS TRUE
      AND public.bc_web_weapon_normalize_text(position) NOT IN ('khong co', 'left', 'out')
    LIMIT 1;

    v_actor_found := FOUND;

    IF NOT v_actor_found AND NOT v_has_web_access THEN
        RAISE EXCEPTION 'User is not an active Lang Gia member';
    END IF;

    v_actor_position := CASE
        WHEN v_actor_found THEN public.bc_web_weapon_normalize_text(v_actor.position)
        ELSE ''
    END;
    v_is_manager := v_has_web_access
        OR v_actor_position IN (
            'bc',
            'bang chu',
            'chu bang',
            'chu guild',
            'pbc',
            'pho bang chu',
            'pho guild',
            'kc',
            'ky cuong',
            'ql',
            'quan ly',
            'quan tri',
            'ky cuu'
        );
    v_is_self_update := v_actor_found AND p_discord_id = v_actor_discord_id;

    IF NOT v_is_manager THEN
        SELECT EXISTS (
            SELECT 1
            FROM (
                SELECT
                    public.bc_web_weapon_jsonb_value(to_jsonb(s)->'leader_ids', '{}'::jsonb) AS leader_ids,
                    public.bc_web_weapon_jsonb_value(to_jsonb(s)->'team_attack1', '[]'::jsonb) AS team_attack1,
                    public.bc_web_weapon_jsonb_value(to_jsonb(s)->'team_attack2', '[]'::jsonb) AS team_attack2,
                    public.bc_web_weapon_jsonb_value(to_jsonb(s)->'team_defense', '[]'::jsonb) AS team_defense,
                    public.bc_web_weapon_jsonb_value(to_jsonb(s)->'team_forest', '[]'::jsonb) AS team_forest,
                    public.bc_web_weapon_jsonb_value(to_jsonb(s)->'waiting_list', '[]'::jsonb) AS waiting_list,
                    public.bc_web_weapon_jsonb_value(
                        coalesce(nullif(to_jsonb(s)->'teams_json', 'null'::jsonb), to_jsonb(s)->'teams'),
                        '{}'::jsonb
                    ) AS teams_json
                FROM public.bc_sessions s
                WHERE s.guild_id = p_guild_id
                  AND coalesce(to_jsonb(s)->>'status', 'active') = 'active'
            ) s
            WHERE (
                  s.leader_ids->>'creator_id' = v_actor_discord_id
                  OR s.leader_ids->>'commander' = v_actor_discord_id
                  OR s.leader_ids->>'team1' = v_actor_discord_id
                  OR s.leader_ids->>'team2' = v_actor_discord_id
                  OR s.leader_ids->>'team3' = v_actor_discord_id
                  OR s.leader_ids->>'team4' = v_actor_discord_id
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_each_text(
                          CASE
                              WHEN jsonb_typeof(s.leader_ids->'teams') = 'object' THEN s.leader_ids->'teams'
                              ELSE '{}'::jsonb
                          END
                      ) item
                      WHERE item.value = v_actor_discord_id
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(
                          (CASE WHEN jsonb_typeof(s.team_attack1) = 'array' THEN s.team_attack1 ELSE '[]'::jsonb END)
                          || (CASE WHEN jsonb_typeof(s.team_attack2) = 'array' THEN s.team_attack2 ELSE '[]'::jsonb END)
                          || (CASE WHEN jsonb_typeof(s.team_defense) = 'array' THEN s.team_defense ELSE '[]'::jsonb END)
                          || (CASE WHEN jsonb_typeof(s.team_forest) = 'array' THEN s.team_forest ELSE '[]'::jsonb END)
                          || (CASE WHEN jsonb_typeof(s.waiting_list) = 'array' THEN s.waiting_list ELSE '[]'::jsonb END)
                      ) member(value)
                      WHERE public.bc_web_weapon_member_is_leader(member.value, v_actor_discord_id)
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_each(
                          CASE
                              WHEN jsonb_typeof(s.teams_json) = 'object' THEN s.teams_json
                              ELSE '{}'::jsonb
                          END
                      ) team(key, value)
                      CROSS JOIN LATERAL jsonb_array_elements(
                          CASE WHEN jsonb_typeof(team.value) = 'array' THEN team.value ELSE '[]'::jsonb END
                      ) member(value)
                      WHERE public.bc_web_weapon_member_is_leader(member.value, v_actor_discord_id)
                  )
              )
        )
        INTO v_is_session_leader;
    END IF;

    IF NOT (v_is_manager OR v_is_session_leader OR v_is_self_update) THEN
        RAISE EXCEPTION 'Not allowed to update web weapon roles';
    END IF;

    IF jsonb_typeof(coalesce(p_web_weapon_roles, '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'web_weapon_roles must be an array';
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(role_id) ORDER BY first_ord), '[]'::jsonb)
    INTO v_roles
    FROM (
        SELECT role_id, min(ord) AS first_ord
        FROM (
            SELECT item.value #>> '{}' AS role_id, item.ord
            FROM jsonb_array_elements(coalesce(p_web_weapon_roles, '[]'::jsonb)) WITH ORDINALITY AS item(value, ord)
            WHERE NULLIF(item.value #>> '{}', '') IS NOT NULL
              AND item.value #>> '{}' = ANY (ARRAY[
                  'Chi_Mang_Tieu',
                  'Cuu_Kiem',
                  'Du_Nem',
                  'Hoanh_Dao',
                  'Hong_Phu_Dao',
                  'Kinh_Than_Thuong',
                  'Linh_Hon_Anh_Tan',
                  'Mach_Dao',
                  'Mac_Thuy_Phien',
                  'Phong_Loi_Thuong',
                  'Roi_Nem',
                  'Song_Dao',
                  'Van_Linh_Duoc_Phien',
                  'Vo_Danh_Kiem',
                  'Vo_Danh_Thuong',
                  'Xuan_Sac_Tan'
              ])
        ) valid
        GROUP BY role_id
        ORDER BY min(ord)
        LIMIT 2
    ) cleaned;

    UPDATE public.bc_users
    SET web_weapon_roles = v_roles,
        updated_at = now()
    WHERE guild_id = p_guild_id
      AND discord_id = p_discord_id
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target member not found';
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.bc_manager_update_web_weapon_roles(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bc_manager_update_web_weapon_roles(text, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
