-- Run this once in Supabase SQL Editor.
-- It lets authenticated Lang Gia members join/leave their own BC session
-- without granting broad UPDATE access on public.bc_sessions.

CREATE OR REPLACE FUNCTION public.bc_update_own_session_registration(
    p_guild_id text,
    p_session_id uuid,
    p_join boolean
)
RETURNS public.bc_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_auth_id uuid := auth.uid();
    v_discord_id text;
    v_discord_name text;
    v_user public.bc_users%ROWTYPE;
    v_session public.bc_sessions%ROWTYPE;
    v_layout jsonb;
    v_teams jsonb;
    v_waiting jsonb;
    v_player jsonb;
    v_existing_member jsonb;
    v_team jsonb;
    v_team_id text;
    v_team_arr jsonb;
    v_filtered jsonb;
    v_capacity integer;
    v_added boolean := false;
    v_leader_ids jsonb;
    v_attack1 jsonb;
    v_attack2 jsonb;
    v_defense jsonb;
    v_forest jsonb;
    v_result public.bc_sessions%ROWTYPE;
BEGIN
    IF v_auth_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT
        raw_user_meta_data->>'provider_id',
        COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name')
    INTO v_discord_id, v_discord_name
    FROM auth.users
    WHERE id = v_auth_id;

    IF NULLIF(v_discord_id, '') IS NULL THEN
        RAISE EXCEPTION 'Discord identity not found';
    END IF;

    SELECT *
    INTO v_user
    FROM public.bc_users
    WHERE guild_id = p_guild_id
      AND discord_id = v_discord_id
      AND lang_gia_member IS TRUE
      AND lower(regexp_replace(coalesce(position, ''), '[^a-zA-Z0-9]+', ' ', 'g')) NOT IN ('khong co', 'left', 'out')
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User is not an active Lang Gia member';
    END IF;

    SELECT *
    INTO v_session
    FROM public.bc_sessions
    WHERE id = p_session_id
      AND guild_id = p_guild_id
      AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BC session not found';
    END IF;

    v_layout := CASE
        WHEN v_session.team_layout IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(v_session.team_layout) = 'string' THEN COALESCE(NULLIF(v_session.team_layout #>> '{}', '')::jsonb, '[]'::jsonb)
        ELSE v_session.team_layout
    END;
    IF jsonb_typeof(v_layout) <> 'array' OR jsonb_array_length(v_layout) = 0 THEN
        v_layout := '[
            {"id":"team_attack1","name":"TEAM CONG 1","icon":"ATK","capacity":10,"order":1},
            {"id":"team_attack2","name":"TEAM CONG 2","icon":"ATK","capacity":10,"order":2},
            {"id":"team_defense","name":"TEAM THU","icon":"DEF","capacity":5,"order":3},
            {"id":"team_forest","name":"TEAM RUNG","icon":"JNG","capacity":5,"order":4}
        ]'::jsonb;
    END IF;

    v_teams := CASE
        WHEN v_session.teams_json IS NULL THEN '{}'::jsonb
        WHEN jsonb_typeof(v_session.teams_json) = 'string' THEN COALESCE(NULLIF(v_session.teams_json #>> '{}', '')::jsonb, '{}'::jsonb)
        ELSE v_session.teams_json
    END;
    IF jsonb_typeof(v_teams) <> 'object' OR v_teams = '{}'::jsonb THEN
        v_teams := jsonb_build_object(
            'team_attack1', CASE
                WHEN v_session.team_attack1 IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(v_session.team_attack1) = 'string' THEN COALESCE(NULLIF(v_session.team_attack1 #>> '{}', '')::jsonb, '[]'::jsonb)
                ELSE v_session.team_attack1
            END,
            'team_attack2', CASE
                WHEN v_session.team_attack2 IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(v_session.team_attack2) = 'string' THEN COALESCE(NULLIF(v_session.team_attack2 #>> '{}', '')::jsonb, '[]'::jsonb)
                ELSE v_session.team_attack2
            END,
            'team_defense', CASE
                WHEN v_session.team_defense IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(v_session.team_defense) = 'string' THEN COALESCE(NULLIF(v_session.team_defense #>> '{}', '')::jsonb, '[]'::jsonb)
                ELSE v_session.team_defense
            END,
            'team_forest', CASE
                WHEN v_session.team_forest IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(v_session.team_forest) = 'string' THEN COALESCE(NULLIF(v_session.team_forest #>> '{}', '')::jsonb, '[]'::jsonb)
                ELSE v_session.team_forest
            END
        );
    END IF;
    v_waiting := CASE
        WHEN v_session.waiting_list IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(v_session.waiting_list) = 'string' THEN COALESCE(NULLIF(v_session.waiting_list #>> '{}', '')::jsonb, '[]'::jsonb)
        ELSE v_session.waiting_list
    END;

    SELECT member
    INTO v_existing_member
    FROM (
        SELECT value AS member
        FROM jsonb_each(v_teams) team_entry
        CROSS JOIN LATERAL jsonb_array_elements(team_entry.value) value
        WHERE value->>'id' = v_discord_id
        UNION ALL
        SELECT value AS member
        FROM jsonb_array_elements(v_waiting) value
        WHERE value->>'id' = v_discord_id
    ) existing
    LIMIT 1;

    IF p_join THEN
        IF v_existing_member IS NULL THEN
            v_player := jsonb_strip_nulls(jsonb_build_object(
                'id', v_discord_id,
                'name', COALESCE(NULLIF(v_user.game_username, ''), NULLIF(v_user.discord_name, ''), v_discord_name, v_discord_id),
                'username', COALESCE(NULLIF(v_user.discord_name, ''), v_discord_name, v_discord_id),
                'gn', NULLIF(v_user.game_username, ''),
                'sub', COALESCE(NULLIF(v_user.weapon_role, ''), NULLIF(v_user.sub_role, '')),
                'role', COALESCE(NULLIF(v_user.combat_role, ''), 'DPS'),
                'joinedAt', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
            ));

            FOR v_team IN
                SELECT elem
                FROM jsonb_array_elements(v_layout) AS item(elem)
                ORDER BY COALESCE((elem->>'order')::int, 999)
            LOOP
                v_team_id := v_team->>'id';
                v_capacity := COALESCE((v_team->>'capacity')::int, 0);
                IF v_team_id IS NULL OR v_capacity <= 0 THEN
                    CONTINUE;
                END IF;
                v_team_arr := COALESCE(v_teams->v_team_id, '[]'::jsonb);
                IF jsonb_typeof(v_team_arr) = 'array' AND jsonb_array_length(v_team_arr) < v_capacity THEN
                    v_teams := jsonb_set(v_teams, ARRAY[v_team_id], v_team_arr || jsonb_build_array(v_player), true);
                    v_added := true;
                    EXIT;
                END IF;
            END LOOP;

            IF NOT v_added THEN
                v_waiting := v_waiting || jsonb_build_array(v_player);
            END IF;
        END IF;
    ELSE
        IF v_existing_member IS NOT NULL
           AND (
               lower(coalesce(v_existing_member->>'isLeader', 'false')) IN ('true', '1')
               OR lower(coalesce(v_existing_member->>'ld', 'false')) IN ('true', '1')
               OR lower(coalesce(v_existing_member->>'isTeamLeader', 'false')) IN ('true', '1')
           ) THEN
            RAISE EXCEPTION 'Leader cannot leave';
        END IF;

        FOR v_team_id, v_team_arr IN SELECT key, value FROM jsonb_each(v_teams)
        LOOP
            SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
            INTO v_filtered
            FROM jsonb_array_elements(v_team_arr) AS item(value)
            WHERE value->>'id' <> v_discord_id;
            v_teams := jsonb_set(v_teams, ARRAY[v_team_id], v_filtered, true);
        END LOOP;

        SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
        INTO v_waiting
        FROM jsonb_array_elements(v_waiting) AS item(value)
        WHERE value->>'id' <> v_discord_id;
    END IF;

    v_attack1 := COALESCE(v_teams -> COALESCE(v_layout->0->>'id', 'team_attack1'), '[]'::jsonb);
    v_attack2 := COALESCE(v_teams -> COALESCE(v_layout->1->>'id', 'team_attack2'), '[]'::jsonb);
    v_defense := COALESCE(v_teams -> COALESCE(v_layout->2->>'id', 'team_defense'), '[]'::jsonb);
    v_forest := COALESCE(v_teams -> COALESCE(v_layout->3->>'id', 'team_forest'), '[]'::jsonb);

    v_leader_ids := (CASE
            WHEN v_session.leader_ids IS NULL THEN '{}'::jsonb
            WHEN jsonb_typeof(v_session.leader_ids) = 'string' THEN COALESCE(NULLIF(v_session.leader_ids #>> '{}', '')::jsonb, '{}'::jsonb)
            ELSE v_session.leader_ids
        END)
        || jsonb_build_object(
            'editor_id', v_discord_id,
            'editor_name', COALESCE(NULLIF(v_user.game_username, ''), NULLIF(v_user.discord_name, ''), v_discord_name, v_discord_id),
            'editor_action', CASE WHEN p_join THEN 'self_join_rpc' ELSE 'self_leave_rpc' END,
            'edited_at', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
        );

    UPDATE public.bc_sessions
    SET team_attack1 = v_attack1,
        team_attack2 = v_attack2,
        team_defense = v_defense,
        team_forest = v_forest,
        waiting_list = v_waiting,
        team_layout = v_layout,
        teams_json = v_teams,
        leader_ids = v_leader_ids,
        updated_at = now()
    WHERE id = p_session_id
      AND guild_id = p_guild_id
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.bc_update_own_session_registration(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bc_update_own_session_registration(text, uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
