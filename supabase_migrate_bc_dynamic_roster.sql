-- Dynamic Bang Chien roster support.
-- Run once in Supabase SQL Editor before deploying dynamic team editor changes.

ALTER TABLE public.bc_sessions
    ADD COLUMN IF NOT EXISTS team_layout JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS teams JSONB DEFAULT NULL;

-- Backfill existing 4-team sessions into the dynamic shape.
UPDATE public.bc_sessions
SET
    team_layout = COALESCE(team_layout, jsonb_build_array(
        jsonb_build_object(
            'id', 'team_attack1',
            'name', COALESCE(team_names->>'attack1', 'TEAM CONG 1'),
            'icon', 'ATK',
            'capacity', COALESCE((team_sizes->>'attack1')::int, 10),
            'order', 1
        ),
        jsonb_build_object(
            'id', 'team_attack2',
            'name', COALESCE(team_names->>'attack2', 'TEAM CONG 2'),
            'icon', 'ATK',
            'capacity', COALESCE((team_sizes->>'attack2')::int, 10),
            'order', 2
        ),
        jsonb_build_object(
            'id', 'team_defense',
            'name', COALESCE(team_names->>'defense', 'TEAM THU'),
            'icon', 'DEF',
            'capacity', COALESCE((team_sizes->>'defense')::int, 5),
            'order', 3
        ),
        jsonb_build_object(
            'id', 'team_forest',
            'name', COALESCE(team_names->>'forest', 'TEAM RUNG'),
            'icon', 'JNG',
            'capacity', COALESCE((team_sizes->>'forest')::int, 5),
            'order', 4
        )
    )),
    teams = COALESCE(teams, jsonb_build_object(
        'team_attack1', COALESCE(team_attack1, '[]'::jsonb),
        'team_attack2', COALESCE(team_attack2, '[]'::jsonb),
        'team_defense', COALESCE(team_defense, '[]'::jsonb),
        'team_forest', COALESCE(team_forest, '[]'::jsonb)
    ))
WHERE team_layout IS NULL OR teams IS NULL;

ALTER TABLE public.bc_sessions REPLICA IDENTITY FULL;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bc_sessions'
  AND column_name IN ('team_layout', 'teams');
