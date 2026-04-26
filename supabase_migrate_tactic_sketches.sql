-- Web tactic sketch page: freehand drawings saved per account/session.
-- Run this in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS bc_tactic_sketches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    session_id UUID,
    day TEXT NOT NULL CHECK (day IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    discord_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Phác thảo',
    is_public BOOLEAN NOT NULL DEFAULT true,
    payload JSONB NOT NULL DEFAULT '{"version":1,"marks":[]}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tactic_sketches_owner
    ON bc_tactic_sketches(guild_id, session_id, day, discord_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tactic_sketches_public
    ON bc_tactic_sketches(guild_id, session_id, day, is_public, updated_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bc_tactic_sketches_updated_at ON bc_tactic_sketches;
CREATE TRIGGER bc_tactic_sketches_updated_at
    BEFORE UPDATE ON bc_tactic_sketches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bc_tactic_sketches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read bc_tactic_sketches" ON bc_tactic_sketches;
CREATE POLICY "Authenticated users can read bc_tactic_sketches"
    ON bc_tactic_sketches FOR SELECT
    TO authenticated
    USING (
        is_public = true
        OR discord_id = COALESCE(
            auth.jwt() -> 'user_metadata' ->> 'provider_id',
            auth.jwt() -> 'user_metadata' ->> 'sub',
            auth.jwt() ->> 'sub'
        )
    );

DROP POLICY IF EXISTS "Authenticated users can insert own bc_tactic_sketches" ON bc_tactic_sketches;
CREATE POLICY "Authenticated users can insert own bc_tactic_sketches"
    ON bc_tactic_sketches FOR INSERT
    TO authenticated
    WITH CHECK (
        discord_id = COALESCE(
            auth.jwt() -> 'user_metadata' ->> 'provider_id',
            auth.jwt() -> 'user_metadata' ->> 'sub',
            auth.jwt() ->> 'sub'
        )
    );

DROP POLICY IF EXISTS "Authenticated users can update own bc_tactic_sketches" ON bc_tactic_sketches;
CREATE POLICY "Authenticated users can update own bc_tactic_sketches"
    ON bc_tactic_sketches FOR UPDATE
    TO authenticated
    USING (
        discord_id = COALESCE(
            auth.jwt() -> 'user_metadata' ->> 'provider_id',
            auth.jwt() -> 'user_metadata' ->> 'sub',
            auth.jwt() ->> 'sub'
        )
    )
    WITH CHECK (
        discord_id = COALESCE(
            auth.jwt() -> 'user_metadata' ->> 'provider_id',
            auth.jwt() -> 'user_metadata' ->> 'sub',
            auth.jwt() ->> 'sub'
        )
    );

DROP POLICY IF EXISTS "Authenticated users can delete own bc_tactic_sketches" ON bc_tactic_sketches;
CREATE POLICY "Authenticated users can delete own bc_tactic_sketches"
    ON bc_tactic_sketches FOR DELETE
    TO authenticated
    USING (
        discord_id = COALESCE(
            auth.jwt() -> 'user_metadata' ->> 'provider_id',
            auth.jwt() -> 'user_metadata' ->> 'sub',
            auth.jwt() ->> 'sub'
        )
    );

DROP POLICY IF EXISTS "Service role can do everything on bc_tactic_sketches" ON bc_tactic_sketches;
CREATE POLICY "Service role can do everything on bc_tactic_sketches"
    ON bc_tactic_sketches FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1
           FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'bc_tactic_sketches'
       )
    THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE bc_tactic_sketches;
    END IF;
END $$;
