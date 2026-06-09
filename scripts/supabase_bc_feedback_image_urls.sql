-- Add optional image attachments for web feedback comments.
-- Run this after the existing bc_feedback table has been created.

DO $$
BEGIN
    IF to_regclass('public.bc_feedback') IS NOT NULL THEN
        ALTER TABLE public.bc_feedback
            ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

        COMMENT ON COLUMN public.bc_feedback.image_urls
            IS 'Public image URLs attached to anonymous web feedback comments.';
    END IF;
END $$;
