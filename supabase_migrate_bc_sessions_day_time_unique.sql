-- Allow multiple active Bang Chien sessions on one day, keyed by day + time.
-- Run once in Supabase SQL Editor before using weekend 20:00+ sessions.

ALTER TABLE public.bc_sessions
    ADD COLUMN IF NOT EXISTS time TEXT DEFAULT '19:30';

UPDATE public.bc_sessions
SET time = '19:30'
WHERE time IS NULL OR btrim(time) = '';

ALTER TABLE public.bc_sessions
    DROP CONSTRAINT IF EXISTS bc_sessions_guild_id_day_key;

DROP INDEX IF EXISTS public.idx_bc_sessions_guild_day_unique;

CREATE UNIQUE INDEX IF NOT EXISTS bc_sessions_guild_id_day_time_key
    ON public.bc_sessions (guild_id, day, time);

ALTER TABLE public.bc_sessions REPLICA IDENTITY FULL;
