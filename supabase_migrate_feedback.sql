-- ============================================
-- Migration: anonymous web feedback
-- Public web list stores only anonymous feedback content.
-- Reporter identity is sent to Discord webhook by the web client.
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
          AND lower(coalesce(u.position, '')) IN (
              'bc',
              'pbc',
              'kc',
              'ql',
              'quan ly',
              'quản lý',
              'ky cuu',
              'kỳ cựu'
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.bc_is_active_langgia_member(target_guild_id TEXT)
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
          AND lower(coalesce(u.position, '')) NOT IN ('khong co', 'left', 'out')
    );
$$;

CREATE TABLE IF NOT EXISTS public.bc_feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    guild_id TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'feedback'
        CHECK (category IN ('feedback', 'bug', 'suggestion', 'other')),
    content TEXT NOT NULL
        CHECK (char_length(trim(content)) BETWEEN 1 AND 1500),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_feedback_guild_created
    ON public.bc_feedback(guild_id, created_at DESC);

ALTER TABLE public.bc_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active LangGia members can read bc_feedback" ON public.bc_feedback;
DROP POLICY IF EXISTS "Active LangGia members can insert bc_feedback" ON public.bc_feedback;
DROP POLICY IF EXISTS "Staff can delete bc_feedback" ON public.bc_feedback;
DROP POLICY IF EXISTS "Service role can do everything on bc_feedback" ON public.bc_feedback;

CREATE POLICY "Active LangGia members can read bc_feedback"
    ON public.bc_feedback FOR SELECT
    TO authenticated
    USING (public.bc_is_active_langgia_member(guild_id));

CREATE POLICY "Active LangGia members can insert bc_feedback"
    ON public.bc_feedback FOR INSERT
    TO authenticated
    WITH CHECK (public.bc_is_active_langgia_member(guild_id));

CREATE POLICY "Staff can delete bc_feedback"
    ON public.bc_feedback FOR DELETE
    TO authenticated
    USING (public.bc_is_staff());

CREATE POLICY "Service role can do everything on bc_feedback"
    ON public.bc_feedback FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
