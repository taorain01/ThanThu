-- ============================================
-- Migration: allow web roster history logs
-- Run after supabase_migrate_secure_editor_policies.sql.
-- ============================================

CREATE OR REPLACE FUNCTION public.bc_log_session_id(details JSONB)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN NULLIF(details ->> 'session_id', '')::uuid;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS "Staff and session leaders can insert web bc_logs" ON bc_logs;

CREATE POLICY "Staff and session leaders can insert web bc_logs"
    ON bc_logs FOR INSERT
    TO authenticated
    WITH CHECK (
        source = 'web'
        AND action IN ('roster_sync', 'quick_team')
        AND (performed_by IS NULL OR performed_by = public.bc_current_discord_id())
        AND public.bc_is_session_leader(
            guild_id,
            public.bc_log_session_id(details),
            details ->> 'day'
        )
    );
