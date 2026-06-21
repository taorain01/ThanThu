ALTER TABLE public.bc_sessions
  ADD COLUMN IF NOT EXISTS channel_id text;
