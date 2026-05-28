-- Migration: tighten bc_regulars web write policies.
-- Authenticated web users can only write their own sat/sun regular rows
-- while they are still active LangGia members. The service role keeps full access.

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

DELETE FROM public.bc_regulars
WHERE day NOT IN ('sat', 'sun');

ALTER TABLE public.bc_regulars DROP CONSTRAINT IF EXISTS bc_regulars_day_check;
ALTER TABLE public.bc_regulars
    ADD CONSTRAINT bc_regulars_day_check CHECK (day IN ('sat', 'sun'));
ALTER TABLE public.bc_regulars REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "Authenticated users can insert bc_regulars" ON public.bc_regulars;
DROP POLICY IF EXISTS "Authenticated users can update bc_regulars" ON public.bc_regulars;
DROP POLICY IF EXISTS "Authenticated users can delete bc_regulars" ON public.bc_regulars;
DROP POLICY IF EXISTS "Regular owners can insert bc_regulars" ON public.bc_regulars;
DROP POLICY IF EXISTS "Regular owners can update bc_regulars" ON public.bc_regulars;
DROP POLICY IF EXISTS "Regular owners can delete bc_regulars" ON public.bc_regulars;

CREATE POLICY "Regular owners can insert bc_regulars"
    ON public.bc_regulars FOR INSERT
    TO authenticated
    WITH CHECK (public.bc_can_write_own_regular(guild_id, discord_id, day));

CREATE POLICY "Regular owners can update bc_regulars"
    ON public.bc_regulars FOR UPDATE
    TO authenticated
    USING (public.bc_can_write_own_regular(guild_id, discord_id, day))
    WITH CHECK (public.bc_can_write_own_regular(guild_id, discord_id, day));

CREATE POLICY "Regular owners can delete bc_regulars"
    ON public.bc_regulars FOR DELETE
    TO authenticated
    USING (public.bc_can_write_own_regular(guild_id, discord_id, day));
