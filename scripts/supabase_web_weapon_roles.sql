-- Run once in Supabase SQL Editor.
-- Adds two web-only weapon icon slots for Bang Chien members.

ALTER TABLE public.bc_users
ADD COLUMN IF NOT EXISTS web_weapon_roles jsonb NOT NULL DEFAULT '[]'::jsonb;

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
    v_result public.bc_users%ROWTYPE;
    v_roles jsonb;
    v_is_manager boolean := false;
    v_is_session_leader boolean := false;
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

    SELECT *
    INTO v_actor
    FROM public.bc_users
    WHERE guild_id = p_guild_id
      AND discord_id = v_actor_discord_id
      AND lang_gia_member IS TRUE
      AND lower(regexp_replace(coalesce(position, ''), '[^a-zA-Z0-9]+', ' ', 'g')) NOT IN ('khong co', 'left', 'out')
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not an active Lang Gia member';
    END IF;

    v_is_manager := lower(regexp_replace(coalesce(v_actor.position, ''), '[^a-zA-Z0-9]+', ' ', 'g'))
        IN ('bc', 'pbc', 'kc', 'ql', 'quan ly', 'ky cuu');

    IF NOT v_is_manager THEN
        SELECT EXISTS (
            SELECT 1
            FROM (
                SELECT CASE
                    WHEN s.leader_ids IS NULL THEN '{}'::jsonb
                    WHEN jsonb_typeof(s.leader_ids) = 'string' THEN COALESCE(NULLIF(s.leader_ids #>> '{}', '')::jsonb, '{}'::jsonb)
                    ELSE s.leader_ids
                END AS leader_ids
                FROM public.bc_sessions s
                WHERE s.guild_id = p_guild_id
                  AND coalesce(s.status, 'active') = 'active'
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
                      FROM jsonb_each_text(coalesce(s.leader_ids->'teams', '{}'::jsonb)) item
                      WHERE item.value = v_actor_discord_id
                  )
              )
        )
        INTO v_is_session_leader;
    END IF;

    IF NOT (v_is_manager OR v_is_session_leader) THEN
        RAISE EXCEPTION 'Not allowed to update web weapon roles';
    END IF;

    IF jsonb_typeof(coalesce(p_web_weapon_roles, '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'web_weapon_roles must be an array';
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(role_id)), '[]'::jsonb)
    INTO v_roles
    FROM (
        SELECT DISTINCT value #>> '{}' AS role_id
        FROM jsonb_array_elements(coalesce(p_web_weapon_roles, '[]'::jsonb)) AS item(value)
        WHERE NULLIF(value #>> '{}', '') IS NOT NULL
          AND value #>> '{}' = ANY (ARRAY[
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
