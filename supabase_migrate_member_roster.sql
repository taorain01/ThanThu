-- ============================================
-- Lang Gia member roster realtime sync
-- Run in Supabase SQL Editor after supabase_setup.sql.
-- ============================================

ALTER TABLE public.bc_users
    ADD COLUMN IF NOT EXISTS combat_role TEXT,
    ADD COLUMN IF NOT EXISTS weapon_role TEXT,
    ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS added_by TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'bot',
    ADD COLUMN IF NOT EXISTS revision BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS role_updated_at TIMESTAMPTZ;

ALTER TABLE public.bc_users REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.bc_pending_ids (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    game_uid TEXT NOT NULL,
    game_username TEXT NOT NULL,
    joined_at TIMESTAMPTZ,
    added_by TEXT,
    added_by_name TEXT,
    source TEXT DEFAULT 'bot',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(guild_id, game_uid)
);

ALTER TABLE public.bc_pending_ids REPLICA IDENTITY FULL;
ALTER TABLE public.bc_pending_ids ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bc_users_guild_active
    ON public.bc_users(guild_id, lang_gia_member, position);

CREATE INDEX IF NOT EXISTS idx_bc_pending_ids_guild_created
    ON public.bc_pending_ids(guild_id, created_at DESC);

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bc_users;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bc_pending_ids;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.bc_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bc_pending_ids_updated_at ON public.bc_pending_ids;
CREATE TRIGGER bc_pending_ids_updated_at
    BEFORE UPDATE ON public.bc_pending_ids
    FOR EACH ROW
    EXECUTE FUNCTION public.bc_touch_updated_at();

CREATE OR REPLACE FUNCTION public.bc_normalize_access_role(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT trim(regexp_replace(
        lower(translate(coalesce(value, ''),
            'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ',
            'aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy'
        )),
        '[^a-z0-9]+', ' ', 'g'
    ));
$$;

CREATE OR REPLACE FUNCTION public.bc_has_manager_access(target_guild_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.bc_users u
        WHERE u.guild_id = target_guild_id
          AND u.discord_id = public.bc_current_discord_id()
          AND u.lang_gia_member IS TRUE
          AND public.bc_normalize_access_role(u.position) IN ('bc', 'pbc', 'kc', 'ql', 'quan ly', 'ky cuu')
    );
$$;

CREATE OR REPLACE FUNCTION public.bc_is_active_member(target_guild_id TEXT, target_discord_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.bc_users u
        WHERE u.guild_id = target_guild_id
          AND u.discord_id = target_discord_id
          AND u.lang_gia_member IS TRUE
          AND public.bc_normalize_access_role(u.position) NOT IN ('khong co', 'left', 'out')
          AND u.left_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.bc_normalize_combat_role(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE public.bc_normalize_access_role(value)
        WHEN 'healer' THEN 'Healer'
        WHEN 'tanker' THEN 'Tanker'
        WHEN 'tank' THEN 'Tanker'
        ELSE 'DPS'
    END;
$$;

CREATE OR REPLACE FUNCTION public.bc_normalize_weapon_role(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE upper(replace(coalesce(value, ''), 'Đ', 'D'))
        WHEN 'QD' THEN 'QD'
        WHEN 'VD' THEN 'VD'
        WHEN 'SD' THEN 'SD'
        WHEN '9K' THEN '9K'
        WHEN 'DR' THEN 'DR'
        WHEN 'HD' THEN 'HD'
        WHEN 'HÐ' THEN 'HD'
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.bc_update_own_pickrole(
    p_combat_role TEXT,
    p_weapon_role TEXT DEFAULT NULL
)
RETURNS public.bc_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_discord_id TEXT := public.bc_current_discord_id();
    v_combat_role TEXT := public.bc_normalize_combat_role(p_combat_role);
    v_weapon_role TEXT := public.bc_normalize_weapon_role(p_weapon_role);
    v_row public.bc_users;
BEGIN
    IF v_discord_id IS NULL OR v_discord_id = '' THEN
        RAISE EXCEPTION 'missing discord identity';
    END IF;

    IF v_combat_role <> 'DPS' THEN
        v_weapon_role := NULL;
    END IF;

    UPDATE public.bc_users
    SET combat_role = v_combat_role,
        weapon_role = v_weapon_role,
        sub_role = v_weapon_role,
        role_updated_at = NOW(),
        source = 'web',
        revision = coalesce(revision, 0) + 1,
        updated_at = NOW()
    WHERE discord_id = v_discord_id
      AND lang_gia_member IS TRUE
      AND left_at IS NULL
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'member is not active';
    END IF;

    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_manager_update_member(
    p_guild_id TEXT,
    p_discord_id TEXT,
    p_game_username TEXT DEFAULT NULL,
    p_game_uid TEXT DEFAULT NULL,
    p_position TEXT DEFAULT NULL,
    p_joined_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.bc_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.bc_users;
BEGIN
    IF NOT public.bc_has_manager_access(p_guild_id) THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    UPDATE public.bc_users
    SET game_username = coalesce(nullif(trim(p_game_username), ''), game_username),
        game_uid = coalesce(nullif(trim(p_game_uid), ''), game_uid),
        position = coalesce(nullif(trim(p_position), ''), position),
        joined_at = coalesce(p_joined_at, joined_at),
        source = 'web',
        revision = coalesce(revision, 0) + 1,
        updated_at = NOW()
    WHERE guild_id = p_guild_id
      AND discord_id = p_discord_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'member not found';
    END IF;

    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_manager_update_pending(
    p_guild_id TEXT,
    p_id UUID DEFAULT NULL,
    p_game_uid TEXT DEFAULT NULL,
    p_game_username TEXT DEFAULT NULL,
    p_joined_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.bc_pending_ids
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.bc_pending_ids;
    v_actor TEXT := public.bc_current_discord_id();
BEGIN
    IF NOT public.bc_has_manager_access(p_guild_id) THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    IF p_id IS NOT NULL THEN
        UPDATE public.bc_pending_ids
        SET game_uid = coalesce(nullif(trim(p_game_uid), ''), game_uid),
            game_username = coalesce(nullif(trim(p_game_username), ''), game_username),
            joined_at = coalesce(p_joined_at, joined_at),
            source = 'web',
            updated_at = NOW()
        WHERE id = p_id
          AND guild_id = p_guild_id
        RETURNING * INTO v_row;
    ELSE
        INSERT INTO public.bc_pending_ids (guild_id, game_uid, game_username, joined_at, added_by, added_by_name, source)
        VALUES (
            p_guild_id,
            nullif(trim(p_game_uid), ''),
            nullif(trim(p_game_username), ''),
            p_joined_at,
            v_actor,
            v_actor,
            'web'
        )
        ON CONFLICT (guild_id, game_uid) DO UPDATE SET
            game_username = excluded.game_username,
            joined_at = excluded.joined_at,
            added_by = excluded.added_by,
            added_by_name = excluded.added_by_name,
            source = 'web',
            updated_at = NOW()
        RETURNING * INTO v_row;
    END IF;

    IF NOT FOUND OR v_row.game_uid IS NULL OR v_row.game_username IS NULL THEN
        RAISE EXCEPTION 'invalid pending member';
    END IF;

    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_manager_delete_pending(
    p_guild_id TEXT,
    p_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.bc_has_manager_access(p_guild_id) THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    DELETE FROM public.bc_pending_ids
    WHERE id = p_id
      AND guild_id = p_guild_id;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.bc_manager_add_member_to_session(
    p_session_id UUID,
    p_discord_id TEXT
)
RETURNS public.bc_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    s public.bc_sessions;
    u public.bc_users;
    v_layout JSONB;
    v_teams JSONB;
    v_waiting JSONB;
    v_player JSONB;
    v_team JSONB;
    v_team_id TEXT;
    v_capacity INT;
    v_arr JSONB;
    v_added BOOLEAN := FALSE;
    v_editor JSONB;
BEGIN
    SELECT * INTO s
    FROM public.bc_sessions
    WHERE id = p_session_id
      AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session not found';
    END IF;

    IF NOT public.bc_has_manager_access(s.guild_id) THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    SELECT * INTO u
    FROM public.bc_users
    WHERE guild_id = s.guild_id
      AND discord_id = p_discord_id
      AND lang_gia_member IS TRUE
      AND left_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'member not found or inactive';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(s.team_attack1, '[]'::jsonb) || coalesce(s.team_attack2, '[]'::jsonb) ||
                                  coalesce(s.team_defense, '[]'::jsonb) || coalesce(s.team_forest, '[]'::jsonb) ||
                                  coalesce(s.waiting_list, '[]'::jsonb)) item
        WHERE item ->> 'id' = p_discord_id
    ) OR EXISTS (
        SELECT 1
        FROM jsonb_each(coalesce(s.teams, '{}'::jsonb)) kv,
             jsonb_array_elements(CASE WHEN jsonb_typeof(kv.value) = 'array' THEN kv.value ELSE '[]'::jsonb END) item
        WHERE item ->> 'id' = p_discord_id
    ) THEN
        RETURN s;
    END IF;

    v_layout := CASE
        WHEN jsonb_typeof(s.team_layout) = 'array' AND jsonb_array_length(s.team_layout) > 0 THEN s.team_layout
        ELSE jsonb_build_array(
            jsonb_build_object('id','team_attack1','name','TEAM CONG 1','capacity',coalesce((s.team_sizes->>'attack1')::int,10),'order',1),
            jsonb_build_object('id','team_attack2','name','TEAM CONG 2','capacity',coalesce((s.team_sizes->>'attack2')::int,10),'order',2),
            jsonb_build_object('id','team_defense','name','TEAM THU','capacity',coalesce((s.team_sizes->>'defense')::int,5),'order',3),
            jsonb_build_object('id','team_forest','name','TEAM RUNG','capacity',coalesce((s.team_sizes->>'forest')::int,5),'order',4)
        )
    END;

    v_teams := CASE
        WHEN jsonb_typeof(s.teams) = 'object' THEN s.teams
        ELSE '{}'::jsonb
    END;

    IF NOT (v_teams ? 'team_attack1') THEN v_teams := jsonb_set(v_teams, '{team_attack1}', coalesce(s.team_attack1, '[]'::jsonb), true); END IF;
    IF NOT (v_teams ? 'team_attack2') THEN v_teams := jsonb_set(v_teams, '{team_attack2}', coalesce(s.team_attack2, '[]'::jsonb), true); END IF;
    IF NOT (v_teams ? 'team_defense') THEN v_teams := jsonb_set(v_teams, '{team_defense}', coalesce(s.team_defense, '[]'::jsonb), true); END IF;
    IF NOT (v_teams ? 'team_forest') THEN v_teams := jsonb_set(v_teams, '{team_forest}', coalesce(s.team_forest, '[]'::jsonb), true); END IF;

    v_waiting := coalesce(s.waiting_list, '[]'::jsonb);
    v_player := jsonb_build_object(
        'id', u.discord_id,
        'name', coalesce(u.game_username, u.discord_name, u.discord_id),
        'username', coalesce(u.discord_name, u.game_username, u.discord_id),
        'gn', u.game_username,
        'game_username', u.game_username,
        'role', coalesce(u.combat_role, 'DPS'),
        'sub', coalesce(u.weapon_role, u.sub_role, ''),
        'joinedAt', floor(extract(epoch from now()) * 1000)::bigint
    );

    IF s.locked IS DISTINCT FROM TRUE THEN
        FOR v_team IN
            SELECT value
            FROM jsonb_array_elements(v_layout) WITH ORDINALITY AS t(value, ord)
            ORDER BY coalesce((value->>'order')::int, ord)
        LOOP
            v_team_id := v_team ->> 'id';
            v_capacity := greatest(0, coalesce((v_team ->> 'capacity')::int, 0));
            v_arr := CASE
                WHEN jsonb_typeof(v_teams -> v_team_id) = 'array' THEN v_teams -> v_team_id
                ELSE '[]'::jsonb
            END;

            IF v_capacity > 0 AND jsonb_array_length(v_arr) < v_capacity THEN
                v_player := jsonb_set(v_player, '{team}', to_jsonb(v_team_id), true);
                v_teams := jsonb_set(v_teams, ARRAY[v_team_id], v_arr || jsonb_build_array(v_player), true);
                v_added := TRUE;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    IF NOT v_added THEN
        v_player := jsonb_set(v_player, '{team}', to_jsonb('waiting_list'::text), true);
        v_waiting := v_waiting || jsonb_build_array(v_player);
    END IF;

    v_editor := coalesce(s.leader_ids, '{}'::jsonb) || jsonb_build_object(
        'editor_id', public.bc_current_discord_id(),
        'editor_name', public.bc_current_discord_id(),
        'editor_action', 'member_roster_add',
        'edited_at', floor(extract(epoch from now()) * 1000)::bigint
    );

    UPDATE public.bc_sessions
    SET team_layout = v_layout,
        teams = v_teams,
        team_attack1 = coalesce(v_teams -> (v_layout -> 0 ->> 'id'), '[]'::jsonb),
        team_attack2 = coalesce(v_teams -> (v_layout -> 1 ->> 'id'), '[]'::jsonb),
        team_defense = coalesce(v_teams -> (v_layout -> 2 ->> 'id'), '[]'::jsonb),
        team_forest = coalesce(v_teams -> (v_layout -> 3 ->> 'id'), '[]'::jsonb),
        waiting_list = v_waiting,
        leader_ids = v_editor,
        updated_at = NOW()
    WHERE id = s.id
    RETURNING * INTO s;

    RETURN s;
END;
$$;

DROP POLICY IF EXISTS "Authenticated users can read bc_pending_ids" ON public.bc_pending_ids;
CREATE POLICY "Authenticated users can read bc_pending_ids"
    ON public.bc_pending_ids FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Service role can do everything on bc_pending_ids" ON public.bc_pending_ids;
CREATE POLICY "Service role can do everything on bc_pending_ids"
    ON public.bc_pending_ids FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

GRANT SELECT ON public.bc_pending_ids TO authenticated;
GRANT ALL ON public.bc_pending_ids TO service_role;

GRANT EXECUTE ON FUNCTION public.bc_update_own_pickrole(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bc_manager_update_member(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bc_manager_update_pending(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bc_manager_delete_pending(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bc_manager_add_member_to_session(UUID, TEXT) TO authenticated;
